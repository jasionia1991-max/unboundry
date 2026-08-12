# Unboundry 全量修复、优化与安全发布施工总方案

状态：`APPROVED_BY_USER`
计划版本：`1.8-offline`
建立日期：`2026-08-09`
当前授权：用户已于 2026-08-09 确认本施工文档并启动一次性离线 Goal；**已授权 REM-001～010 与 REM-011 离线工程部分连续施工、本地 checkpoint/功能/candidate commit，未授权真实数据、4173、真实 Provider/OSS、SSH、生产、push、tag、PR、正式版本号或发布**。当前状态为 `REM-000 PASS / REM-001、REM-002、REM-003、REM-004、REM-005、REM-006、REM-007、REM-008、REM-009A USER_REVIEW / REM-009B IN_PROGRESS`。

> 用户已于 2026-08-09 确认本文档为本轮权威施工合同。任何 Agent 在上下文压缩、换人或恢复任务后，都必须重新读取本文件和 `UNBOUNDRY_REMEDIATION_CHECKPOINT.md`，不得凭内部记忆或压缩摘要继续施工。

## 1. 目标与真实承诺

本轮目标是：线上 `v0.5.1` 继续服务，全部授权范围内的修复、优化和验证先在线下完成；候选版本全部验收通过后，再由用户确认版本号和是否发布。

能作出的承诺：

- 线下施工与测试阶段不连接生产主机、不替换线上代码、不重启线上服务、不修改真实数据；
- 测试只使用新建临时数据目录和动态独立端口；
- 测试进程不读取真实 Provider / OSS 凭据，不访问非 loopback 网络，真实付费 Provider 请求为 `0`；
- 正式切换前绝大部分准备工作不影响线上使用；
- 最终切换时尽量保持页面可打开；但首次从缺少维护模式的 `v0.5.1` 切换时，可靠一致备份可能要求短暂显示静态维护页，届时已有内容也可能暂时不可查看，不能虚报为全程可读；
- 暂停时长必须经过备份、迁移和切换演练后实测，不能提前虚报。

不能作出的承诺：

- 当前单机 SQLite 与单生成任务处理器架构下，不能承诺所有写功能绝对零秒停顿；
- 不发真实 Provider 请求时，不能证明 Provider 当前协议、额度、费用和生成质量；
- 不读取或清理真实数据时，不能证明线上不存在历史孤儿文件；本轮只能先在合成数据上完成只读检查工具，是否对真实数据运行必须另行授权；
- 未经生产主机操作授权，不能证明最终 systemd、nginx、磁盘和权限环境完全一致。

## 2. 冻结基线

| 项目 | 2026-08-09 文档建立时事实 |
|---|---|
| 仓库 | `/Users/mymy/Documents/unboundry/app` |
| 分支 | `main` |
| 基线提交 | `262c66c4087d915b03971191ee00a9bfba74da65` |
| Git 状态 | `main...origin/main [ahead 1]`；三份已由用户确认的文档存在未提交修改 |
| package 版本 | `0.5.1` |
| 线上版本 | `canvas.mymy.ltd` 运行 `v0.5.1` |
| 线上程序/数据 | 数据目录历史记录一致为 `/var/lib/unboundry`；程序目录在交接与旧部署计划中分别为 `/opt/unboundry`、`/opt/unboundry-app`，当前未获 SSH 授权核实 |
| 数据库结构 | 当前迁移最高版本 `37` |
| 本轮检测到的本机 Node | `v25.9.0` |
| 施工目标 Node | Node 22 LTS；精确 Node/npm 版本在 REM-001 决策并固定。历史生产记录为 `v22.23.2`，本轮未复核当前生产精确版本 |
| 当前代码授权 | 一次性离线 Goal 已激活；REM-000 PASS、REM-001/002/003/004/005/006/007/008/009A USER_REVIEW、REM-009B IN_PROGRESS；仅限施工合同内的本地隔离工程，生产与外部真实服务永久排除 |

基线发生变化时，先更新断点文件并说明原因；未经用户确认不得静默换仓库、换分支、换线上版本或换目标。

## 3. 权威顺序与冲突处理

发生冲突时按以下顺序判定：

1. 用户在当前任务中的最新明确指令；
2. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` 的当前授权、当前 REM 和硬停止点；
3. 本文件中已经用户确认的施工合同与决策记录；本文件仍为 draft 时不能覆盖断点；
4. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 的验收状态；
5. `TASKS.md` 的证据与施工日志；
6. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md` 与其他历史规格；
7. 自动测试、历史报告和 Agent 内部记忆。

规则：

- 用户新指令可以改变计划，但必须先写入“决策记录”，再改代码；
- 仓库文档、Git 状态、测试证据和上下文摘要不一致时，停止施工并向用户报告；
- Codex memory、rollout summary 和压缩摘要只可用于定位线索，不能作为完成、PASS 或发布证据；
- 同时只允许一个 `REM-*` 项处于施工中的 `IN_PROGRESS`。

## 4. 绝对红线

1. 先分析、给证据和本项方案；用户确认后才修改该项代码。
2. 不修改或删除本地 `app/data`、服务器 `/var/lib/unboundry` 或任何真实媒体、真实备份。
3. 测试数据必须由本轮新建，位于系统临时目录；测试结束必须清理本轮创建的目录。
4. 测试端口必须动态分配并断言不等于 `4173`；不得复用当前固定端口地图作为最终安全保证。
5. 不运行默认 `npm run verify`，直到 REM-001 建立并验证新的安全总入口。
6. 所有测试子进程必须移除真实 Provider、OSS、代理和云账号环境变量；浏览器与 Node 均禁止访问非 loopback 网络。
7. 不发起任何真实或付费 Provider 请求；不把 fixture attempt 说成真实请求。
8. 不 `git reset --hard`、不 `git clean`、不覆盖用户或其他 Agent 的现有改动。
9. 未经用户明确授权，不 commit；任何情况下不擅自 push、tag、SSH 修改、发布或变更云权限。
10. 发布前必须由用户明确确认版本号；“确认版本号”和“确认发布”是两个独立授权。
11. 数据库迁移前必须先有真正只读的一致备份，并在临时目录完成恢复与迁移演练。
12. 每完成一个 REM 项，同步 `TASKS.md`、验收矩阵和施工断点；文档/工程证据进入 `USER_REVIEW`，需要实页验证的产品行为进入 `USER_RECHECK`，两者都只有用户确认后才能 `PASS`。

## 5. 不得漂移的既有产品合同

以下合同已经由用户确认，除非用户另行改变决定，否则本轮修复不得借机改产品语义：

### 5.1 多标签画布：保留 DATA-005

- 不同标签保存同一画布：按最后保存者生效，其他标签自动同步；
- 同一标签内部：迟到的旧请求不得覆盖该标签较新的快照；
- 本轮修复只解决加载失败后空保存、同标签顺序检查竞态、未成功加载的 revision 0 覆盖和生成前未确认保存；
- 不得把不同标签偷偷改成“只有一个成功、另一个 409”。

### 5.2 权限

- 管理员恒有全部权限；
- 普通账号默认五项能力不可撤销；
- 权限保存只维护“额外授予集”；
- 不得因前端无草稿而发送空数组清空已有额外权限。

### 5.3 已取消和暂停范围

- 金额限制、额度、积分、订阅和费用拦截已整体取消，不得复活；
- `IMGEDIT-007` 打光保持 `PAUSED`；
- `AUTH-002 / OPEN-009` 团队与多人保持 `PAUSED`；
- `OPEN-019 / OPEN-021`、真实 Agent、社区、插件市场等不进入本轮；
- OpenRouter 不在服务器启用代理；
- Mureka 真实生成未经用户重新授权不得尝试。

### 5.4 历史 PASS

- 本轮不批量推翻历史 PASS；
- 修改触及历史 PASS 的实现时必须做受影响回归；
- 自动回归发现真实违约时，先提交证据和修复方案，不得为了维持绿色删除或放宽断言。

## 6. 全量审计问题与施工映射

| 编号 | 已确认风险 | 优先级 | 归属施工项 |
|---|---|---|---|
| F-001 | 画布初始加载失败后仍进入可保存状态，可能以空快照覆盖已有画布 | P0 | REM-003，已修 |
| F-002 | 同一标签保存顺序检查在读取请求体前取旧行，检查与 UPSERT 非原子 | P0 | REM-003，已修 |
| F-003 | `document.revision` 只校验格式，未阻止未成功加载的 revision 0 修改已有画布 | P0 | REM-003，已修 |
| F-004 | 客户端 ID 在所有权确认前写共享媒体路径，跨账号并发可先覆盖文件 | P0 | REM-004，离线候选已修 |
| F-005 | 生成结果、媒体行、历史和任务成功分多阶段，失败时可产生孤儿或悬空引用 | P0 | REM-004 媒体发布/补偿 + REM-005 付费/幂等边界，离线候选已修 |
| F-006 | 账号删除按 snake_case 查询却按 camelCase 读取，物理媒体不清理 | P0 | REM-006，离线候选已修 |
| F-007 | 账号删除遗漏个人/公共模板依赖，可能被外键阻止或形成半删除 | P0 | REM-006，离线候选已修 |
| F-008 | 生成安全检查与任务插入不在同一事务，并发请求可绕过频率/并发上限 | P0 | REM-005，离线候选已修（单 active process 前提） |
| F-009 | 排队后到 Provider 边界前未重新检查全局/紧急停止 | P0 | REM-005，离线候选已修 |
| F-010 | Provider task ID 和幂等唯一键缺少必要的账号/凭据作用域 | P1 | REM-005，离线候选已修；生产兼容仍归 REM-009B/010 |
| F-011 | 畸形 `%` 路径可在 decode 阶段抛错，异步 API 又缺少统一兜底，可杀死进程 | P0 | REM-002 |
| F-012 | 登录无速率限制；公开 SSE 无连接、背压和慢客户端上限 | P1 | REM-008 离线候选已修；只证明单 active process 的有界准入 |
| F-013 | 播放列表导出、缩略图等允许超大整体缓冲；ffmpeg/ffprobe 无统一超时和并发限制 | P1 | REM-008 离线候选已修；保留 500MiB 合同 |
| F-014 | Provider 请求缺少统一 deadline；结果 URL 下载缺少完整的私网/重定向/DNS 防护 | P1 | REM-005 deadline + REM-008 结果 URL 防护离线候选已修；仅用假 Provider 验证 |
| F-015 | OSS endpoint 只校验 HTTPS，未完整阻止私网、保留地址和 DNS 重绑定 | P1 | REM-008 离线候选已修；仅用假 OSS 验证 |
| F-016 | 图片/音频带旧结果刷新后可能只显示生成中却不恢复新任务；视频重生成可被旧成功状态跳过 | P1 | REM-007，离线候选已修 |
| F-017A | 权限不改直接保存可能清空额外权限 | P1 | REM-006，离线候选已修 |
| F-017B | 更新提示可在保存失败时仍刷新 | P1 | REM-007，离线候选已修 |
| F-018 | 创建、重命名等失败路径可能丢失草稿或没有明确错误反馈 | P1 | REM-007，离线候选已修 |
| F-019 | 备份脚本会用可迁移/回填的数据库入口打开源库，可能先改库再备份 | P0 | REM-009 |
| F-020 | 数据库、媒体、密钥分阶段复制且无写锁；manifest 覆盖不完整、权限未强制 | P0 | REM-009A 完成只读格式 2 底座；最终候选跨域冻结/恢复仍归 REM-009B |
| F-021 | 发布脚本允许脏文件/.env 风险、原地构建、无 `npm ci`、无可靠备份/回滚 | P0 | REM-010 |
| F-022 | 发布健康检查只查版本号，不打开数据库；发布后才 push，步骤不可安全拆分 | P0 | 保持开放，归 REM-010 |
| F-023 | 新旧服务同时连接真实库会争抢运行中生成任务；SSE 和长请求不会自动排空 | P0 | 未关闭，归 REM-010；REM-005 不证明多进程 worker claim |
| F-024 | 数据库迁移到未知版本后，`v0.5.1` 会拒绝启动，普通蓝绿回滚是假回滚 | P0 | 保持开放，归 REM-009B / REM-010 |
| F-025 | OSS 镜像、密码重置和修复脚本存在 dry-run、目录选择、回显、路径和失败退出问题 | P1 | REM-008 已修密码重置/存储修复子范围；真实 OSS mirror/backup-to-OSS 继续冻结，最终恢复材料归 REM-009B/010 |
| F-026 | 当前推荐回归只覆盖约 80/105 spec、391/519 既有测试；并非真正全量 | P0 | REM-001 |
| F-027 | 固定端口、共享临时库、仓库 tmp 残留和继承真实环境使测试隔离不可靠 | P0 | REM-001 |
| F-028 | 本机 Node 25 与生产 Node 22 不一致，部分结果已受版本影响 | P1 | REM-001 已修；离线施工固定 Node 22.23.1 |
| F-029 | `npm audit` 报 1 个 high 级传递依赖告警；目前未确认项目存在可达的 size=0 调用路径。另缺少完整安全响应头和结构化脱敏日志 | P1 | REM-002 日志 + REM-008 `nanoid 3.3.18`、离线 audit 0 与安全头已收口；只代表当前 lock snapshot/离线候选 |
| F-030 | 大型前端包、缓存/URL 生命周期、长列表和大图内存仍有实际优化空间 | P2 | REM-008 已收口本轮可验证子范围；不排除后续 P2 优化 |
| F-031 | 即使 schema 仍为 37，新版写入的画布 JSON、任务快照、媒体状态/命名和加密 AAD 也可能不被 v0.5.1 安全理解；只比较 schema 会形成假回滚 | P0 | REM-009 / REM-010 |
| F-032 | 当前账号删除会清理相关 `admin_audit_events`；若改为保留审计将改变已 PASS 的 PERM-011 合同 | P0/产品决策 | REM-006 已确认继续 PERM-011：清理旧相关审计，仅保留唯一 `delete_user` 记录 |
| F-033 | 账号删除前未可靠排空/阻止该账号的活动生成任务，删除后任务仍可能写媒体结果 | P0 | REM-006，离线候选已修 |
| F-034 | 主 tsconfig 未覆盖 `server/generationProvider.ts` 与 `playwright.4174.config.ts`，仅说“TypeScript 通过”仍可能漏检跟踪源码 | P1 | REM-001 已修并持续由动态源码门禁覆盖 |
| F-035 | 服务端输入预检信任画布携带的媒体 ready/时长/尺寸字段，伪造元数据可绕过真实素材约束 | P0 | REM-004 / REM-005；REM-001 review 已完成通用权威重建基础 |
| F-036 | 通用输入解析只为 Video 映射宽高，参考图片仍拿不到 `media_assets` 权威尺寸，图片尺寸/比例规则可被静默绕过 | P0 | REM-004，离线候选已修 |
| F-037 | App 传入不稳定的项目缺失回调，打开账号浮层会重新触发画布 hydration 并覆盖当前 Text 选择态 | P1 | REM-003 / REM-007；REM-001 review 已修 |
| F-038 | 管理页面鉴权在 React render 中直接 `location.replace`，StrictMode 可重复导航并产生 `ERR_ABORTED` | P1 | REM-002 / REM-007；REM-001 review 已修 |
| F-039 | 模板节点写入后先预约保存、后开启镜头动画闸门，旧 timer 会在动画中连续保存中间 viewport | P1 | REM-003；REM-001 review 已修 |
| F-040 | `canvas_documents` 只保存最后一个标签的 session/sequence；`A3 → B1 → A2` 会丢掉 A 的高水位，让 A2 旧快照再次合法覆盖 | P0 | REM-003，已修 |
| F-041 | 维护/关闭只按 HTTP method 阻止 mutation，带迁移、回填或任务恢复副作用的 GET 可绕过冻结 | P0 | REM-002，已修 |
| F-042 | 关闭只等待 response finish，未等待 handler 清理和未读请求体，可能假排空或泄漏临时文件 | P0 | REM-002，已修 |
| F-043 | 生成恢复、重试和新任务的 detached Promise 可能形成未处理 rejection 并杀死进程 | P0 | REM-002，已修 |
| F-044 | readiness 只验版本/少量表且 WAL 边界不清，可对损坏 schema 假 READY 或对合法历史库误拒 | P0 | REM-002，已修 |
| F-045 | Vite 信号处理可能误删宿主监听器，close 失败或超时后进程不能可靠结束 | P0 | REM-002，已修 |
| F-046 | 结构化日志在业务 4xx/5xx 时仍可能记录 `code=OK`，误导告警和排障 | P1 | REM-002，已修 |
| F-047 | JSON body、Content-Type、fatal UTF-8、请求中止和 URL 解码在各 API 实现不一致 | P0 | REM-002，已修 |
| F-048 | 客户端把未知 409 当 revision 冲突盲目重试，并可能清空仍未保存的更新草稿 | P0 | REM-003，已修 |
| F-049 | OpenAPI 画布文档遗漏实际 graph/session/sequence 字段与 DATA-005 冲突语义，契约和实现漂移 | P1 | REM-003，已修 |
| F-050 | 备份/恢复先检查后 rename、锁文件按路径清理及中途发布可覆盖或误删并发出现的目录项 | P1 | REM-009A，已修 |
| F-051 | 私钥/可信签名公钥、工作根与父链缺少完整 owner/mode/inode 隔离，签名私钥还可能被当 OSS 镜像打包 | P1 | REM-009A，已修 |
| F-052 | 备份/验签/恢复清理故障可覆盖原错误、遗留明文临时目录，rollback/close 异常可阻止主密钥或 DEK 清零 | P1 | REM-009A，已修 |
| F-053 | 数据根内部可写项/硬链接缺少完整性约束，且 pending/failed OSS `object_key` 被静默排除，形成不完整备份 | P1 | REM-009A，已修 |

## 7. 施工批次

依赖顺序不是简单按编号执行：`REM-000 → REM-001 → REM-002 → REM-009A`。只读备份/恢复底座 REM-009A 通过前，REM-003～008 只能继续分析和做不涉及 schema/持久格式的准备，禁止实施任何数据库、文件、OSS 或 secret 迁移。核心数据修复完成后再执行 REM-009B 的候选 schema/数据格式最终演练，然后进入 REM-010/011。

### REM-000：施工文档与防漂移机制

范围：

- 建立本总方案、施工断点和项目级 `AGENTS.md`；
- 更新 README、交接、TASKS、验收矩阵的权威入口；
- 明确恢复顺序、状态流转、决策门和红线。

完成标准：

- 文档之间没有状态和路径冲突；
- 当前授权明确为“文档完成，等待用户复核”；
- 未修改业务代码、未运行运行时测试、未 commit/push/发布；
- 本完成标准已于 2026-08-09 获用户确认，REM-000 已标记 PASS；这不自动授权 REM-001～011。

### REM-001：绝对隔离的测试安全底座

范围：

- 固定 Node 22 LTS 和准确包管理器版本；精确版本必须在 REM-001 的用户确认方案中记录，不能从相互冲突的历史文档猜测；
- 建立唯一安全总入口，启动前验证数据目录、端口、环境变量和网络；
- 所有服务测试改用动态端口；每个 spec 使用独立新临时目录；
- Node 层禁止非 loopback DNS/HTTP/HTTPS/TCP/TLS，浏览器拦截外部请求；
- 测试发现清单与执行清单逐项核对；
- 所有跟踪 TS/TSX 文件必须被主类型检查覆盖，或有书面排除理由和独立检查；至少补齐当前遗漏的 `server/generationProvider.ts` 与 `playwright.4174.config.ts`；
- 修复组合污染、固定端口和清理机制，不通过 retry/skip 降低要求。

完成标准：

- 当前 `105/105` spec、`520/520` 测试全部有安全执行归属；其中 519 项为原清单，另 1 项是本轮新增的 F-035 fail-closed 回归；
- 真实 4173 进程前后不变；通过规范路径拒绝和文件访问审计证明测试子进程从未打开真实数据路径，不读取、stat 或哈希真实数据库；
- 真实凭据读取、非 loopback 连接、由施工/测试产生的线上域名请求、真实 Provider 请求均为 0；
- 本轮创建的临时目录和进程全部清理。

REM-001 的完成含义仅是“全部测试都能在安全隔离中被发现和诚实执行，并形成当前失败清单”，不要求提前修完后续 REM 对应的产品失败；失败 0 是 REM-011/G2 的最终门。

2026-08-09 离线执行证据：Node `22.23.1` / npm `10.9.8` 已固定；105 个 spec、520 个唯一测试均由安全入口发现并执行；TS/TSX `258/258`、JS/MJS `14/14`、9 个运维脚本、生产构建与重启持久化均纳入隔离门。修复诚实基线暴露的问题后，首轮全量为 `520/520 PASS`，失败、跳过、retry、report error、外部网络阻断均为 0；临时目录全部清理，4173 监听身份不变。本项工程候选进入 `USER_REVIEW`，不等同于用户 PASS，也不替代 REM-011 的三轮最终回归。

### REM-002：API、进程与可观测性基础

范围：安全 URL 解析、统一异步错误边界、请求体错误分类、请求 ID、日志脱敏、存活/就绪检查、维护只读模式、优雅关闭基础。

完成标准：畸形路径和异常请求只返回受控 4xx/5xx；进程继续存活；日志不出现 Cookie、密码、API Key 或完整敏感提示词；就绪检查真正验证数据库与目录但不恢复生成任务。

2026-08-09 离线执行证据：13 处 JSON reader、20 个路径入口与 3 个编码文件名已收敛到统一受控边界；维护/关闭期间 API 使用严格无副作用 allowlist，响应、handler、请求体和 SSE 均纳入排空；请求日志使用 UUID 与固定 8 字段并正确记录业务错误码；Vite dev/preview 精确拥有并恢复自己的信号监听器；3 个 detached 生成启动点的同步/异步失败均被吸收并安全回写。readiness 不调用 `openAppDatabase`，只读核验 schema 37 完整迁移账本、19 张表、27 个显式索引、5 个触发器、SQLite 完整性及有限已证明的 v21/v31 历史物理形态，未知/语义损坏形态 fail-closed。专项 m81 `17/17`；最终安全全量发现/执行 `105/105 spec、536/536 PASS`，失败、跳过、retry、report error、blocked 均为 0；TS/TSX `260/260`、JS/MJS `14/14`。schema `37` 与 package `0.5.1` 不变。本项进入 `USER_REVIEW`，下一施工项为 REM-009A。

### REM-003：画布持久化与已确认多标签语义

范围：加载失败 fail-closed、成功加载凭据/基线保护、同标签 sequence 原子检查、保存/项目墓碑/更新时间同事务、生成前保存门禁、冲突/失败草稿保护。

完成标准：

- 初始 GET 失败、超时、断网后不得写空画布或生成；
- 同一标签旧请求最后到达也不能覆盖新快照；
- 不同标签仍严格遵守 DATA-005“最后保存者胜”；
- 删除项目后旧页面不能复活；
- 50～100 组确定性交错测试不丢数据。

2026-08-09 离线执行证据：服务端以 owner/canvas/revision/epoch 绑定的 load token、session/sequence/attempt 高水位与单事务 canvas/project/tombstone 写入关闭 F-001/F-002/F-003/F-040/F-048/F-049；项目/账号删除容量回收、故障回滚、candidate/legacy/restart 合同均 fail-closed。客户端以账号+画布 scope、strict durable journal CAS 与 input/task owner 覆盖 hydration、普通保存、pagehide、丢响应、超时、跨标签广播、外部基线、BFCache 状态机及生成门禁；未知提交只重试原 attempt/payload，旧任务与迟到响应不能覆盖新输入。冻结测试源码指纹 `2ae382d4b0bed4cfa1e570d1e0172c2b84365dba4abf38ea095eb68e7c59875a`：专项 `205/205`、m28 十轮 `30/30`、核心三轮 `450/450`、安全全量 `107/107 spec、687/687 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0；源码 TS/TSX `264/264`、JS/MJS `15/15`，构建与两次重启通过，4173 监听身份不变。独立终审剩余 P0/P1 为 0；schema `37` 与 package `0.5.1` 不变。相同功能内容提交为 `2a0b7f9819d3075d5fd339e20c5badd389cd51ae`；测试运行于提交前相同文件内容的源码指纹。本项进入 `USER_REVIEW`，当前切换到 REM-004。

### REM-004：统一媒体生命周期

范围：上传前原子预留所有权，本地临时文件+原子 rename，OSS 随机对象键，统一 pending/ready/failed，结果媒体/历史/任务的可重试发布与补偿，只读一致性报告。

完成标准：两个账号并发同一 ID 时文件和 owner 永远一致；文件、OSS、登记、历史、任务每个故障注入点均可恢复或明确报告；只读工具默认绝不删除真实文件。

2026-08-11 离线执行证据：schema 38 候选新增媒体发布 attempt、媒体删除 intent、账号删除 intent 及约束触发器；本地与假 OSS 均按 reserve → stage → publish → finalize 执行，并具备可重启补偿、删除和启动恢复。媒体服务、生成结果、历史、画布和备份检查统一只消费 owner/kind 精确匹配的 ready 素材；新 Provider attempt 使用当前 ready 权威媒体元数据，已有 Provider task 的恢复只验证冻结快照结构，不能因素材后删或模型规则收紧重复付费。客户端只有同步 adoption ACK 后才采用结果；完整性 CLI 默认只读。由此关闭 F-004、F-036 与 F-005 的媒体发布子范围；任务创建幂等、Provider 付费边界仍归 REM-005，账号删除完整合同仍归 REM-006。冻结源码指纹 `f6974d0456eb09b864e7302b85d47172d93d57182610ec42b95c42be4427454c`：专项 `158/158`、核心三轮 `474/474`、安全全量 `109/109 spec、762/762 PASS`，全部异常计数为 0；源码 284，TS/TSX `268/268`、JS/MJS `16/16`，最终监听身份 `c9663ffd4e9e26c675482e713e301f681f172b976a50df952d903fac9f00da0e` 前后不变。功能提交 `9f1019e5686ccce4f646b54a2be6ccd5ab4864d0`；本项进入 `USER_REVIEW`，当前切换到 REM-005。

### REM-005：生成、幂等与付费边界

范围：`BEGIN IMMEDIATE` 内完成幂等查询、开关/频率/并发/熔断判断和任务插入；Provider 边界前重查紧急停止；凭据版本与任务快照一致；统一超时、未知结果保护、禁止自动重复付费。

完成标准：限额为 1 时 10～20 个并发请求最多新建 1 个任务；相同幂等请求返回同一任务；排队后开启紧急停止时 Provider 边界计数为 0；全部使用本地假 Provider，外部网络为 0。

2026-08-11 离线执行证据：schema 39 在 schema 38 媒体底座上新增 owner-scoped idempotency、原子 generation admission 账本、credential epoch 高水位与带 outcome/revision/scope 的 Provider attempt 证据。稳定客户端意图的幂等查询优先于动态闸门；新任务与安全开关、RPM/并发/熔断检查在同一 `BEGIN IMMEDIATE` 内提交，最终付费边界再次核验全局/紧急停止、owner/model/profile/credential revision 与权威参数。accepted、response-received 或 outcome-unknown 绝不自动新建付费 attempt；只有全部既有 paid evidence 均为 definitive-rejected/provider-failed 才允许新付费重试。同步无 remote ID 与异步有 remote ID 的未知结果均可由用户显式 abandon，但账本保持且 Provider 请求为 0。统一 deadline、持久队列进程启动和凭据/Provider profile 变更互斥同时完成。由此关闭 F-008/F-009/F-010，并与 REM-004 一起关闭 F-005；F-014 只关闭 deadline 子范围。测试运行于功能提交前、HEAD `2beaec585d2d33a11341b98349b31b89b41d3a62` 的冻结脏工作树 `6a1363df8a6977e996db4b9e45aa823a89e28d6fe3955d85d6ea0ca9b315fcf9`：m81 `23/23`、6-spec 核心三轮 `207/207`、安全全量 `109/109 spec、790/790 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0；源码 285，TS/TSX `269/269`、JS/MJS `16/16`，11 个运维脚本为 6 个行为验证 + 5 个哈希冻结，4173 listener `6fb8de970741a8dee0ab4c8790e237f3fe5a4c0a3cd4c1cd6a89af12fd6e16c7` 前后不变。功能提交 `b3ceba04b5ddcf781dd58ce355be0e0f7665450e` 包含相同功能文件内容；未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，仅在单一 active process 前提下成立；F-023 仍归 REM-010。

### REM-006：账号删除、模板、权限和清理闭环

范围：修正字段映射、模板外键和媒体清理；先禁用和撤销 session；活动/结果未知任务阻止破坏性删除；按用户最终合同选择硬删除或匿名 tombstone/持久 cleanup job；权限保存使用有效额外授予集。`KEY-008` 的凭据清理和 `AUTH-006` 的受保护最高权限账号不可删除必须继续满足。

开始前决策门：既有 `PERM-011` 合同是“被删账号权限行清零、旧审计按既有语义清理、保留 delete_user 记录”。默认不得擅自改变。用户必须选择继续遵守，或明确用“公共模板保留/转交、既有授权处理、审计保留、个人信息匿名 tombstone”等新合同替代其相应部分；若选择新合同，必须把受影响的 `PERM-011` 等历史 PASS 重新进入适用用户验收，不能继续沿用旧证据。

完成标准：测试账号含画布、任务、媒体、个人模板、公共模板、权限、凭据和审计时，删除流程要么完整成功，要么保持可恢复的一致状态；清理失败可查看、可重试。

2026-08-11 离线执行证据：账号删除使用持久 intent 和可重试 saga，先禁用账号/撤销 session，活动或结果未知任务与进程内活动 mutation/actor lease 阻止删除；公共模板和必要媒体转交受保护最高权限账号，私有行与本地/假 OSS 媒体按持久记录清理并可重试。权限保存只写有效额外授予集，GET 失败不开放破坏性保存，在途保存禁用同账号编辑。账号凭据、Provider profile/catalog 与存储文档的真实 HTTP 变更在最终线性化点重查 actor fence，SQLite 业务元数据与审计同一事务成败；加密文档在锁内写入，并在确定性审计失败时按快照恢复。由此在离线候选关闭 F-006/F-007/F-017A/F-033；F-032 继续旧 PERM-011，删除相关旧审计并仅保留唯一 `delete_user` 记录。

测试运行于功能提交前、HEAD `731b984d7e32a0b9ee648c0e7fa1bd49e59deb14` 下 403-file 冻结脏工作树 `9873952efd5a7b1f0d84d65698be79069a89aae47ab25ff277dabf6b4ef2016d`：14-spec 定向 `112/112`、核心 7-spec `repeat=3` 共 `222/222`、安全全量 `109/109 spec、804/804 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=477`；源码 286，TS/TSX `270/270`、JS/MJS `16/16`，11 个运维脚本为 6 个行为验证 + 5 个哈希冻结，4173 listener `38911ab014a12dd3353ee0897359ebfb26f075144de1ce0b35e760f2df6dea3d` 前后不变。功能提交 `67cc39302d756bc00bff7ac31e31de7a7f574574` 包含相同功能文件，未在该 commit 后或文档后树重跑。独立终审无剩余即时产品 P0/P1；本项进入 `USER_REVIEW`，当前切换 REM-007。该证据不是用户 PASS、真实数据/真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮。结论仅在单一 active process 前提下成立，F-023 仍归 REM-010；账号删除是跨物理媒体的持久 saga，文档/SQLite 变更不声称跨文件系统的进程崩溃原子性。线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### REM-007：前端生成恢复与失败体验

范围：四类生成统一 active task 契约；旧预览与新任务分离；图片/音频刷新恢复；视频重生成；更新通知只在保存成功后刷新；创建、重命名失败保留草稿并明确提示。Audio 全生命周期只使用本地假 Provider；`INPUT-006 / AUDIO-REAL-001` 的真实 Mureka 边界保持原 PARTIAL/暂停状态。

完成标准：文字/图片/视频/音频均覆盖首次、重生成、刷新、丢 POST 响应、服务重启、取消、失败、成功、旧结果仍在；每次操作恰好对应一个任务。

2026-08-12 离线执行证据：F-016/F-017B/F-018 已在离线候选修复。四类节点把持久 `*GenerationOwnershipKey`、exact task/idempotency GET、model/name 和完整 normalized parameters 快照与 active task 同步绑定；付费 POST 前先 materialize effective 快照并取得 fresh canvas revision，新任务期间保留旧预览。对仍匹配当前 ownership 的 active task，success/failed/cancelled 节点状态先持久并获得 canvas ACK，再按 taskId 清 submission intent；preflight 拒绝保留 intent；恢复调用缺失或不同于已有 raw ownership proof 时不认领并保留。显式输入或新 ownership 会撤销/替换旧 intent；legacy signature 无法升级、恢复路径确认持久绑定已失效、提交前 exact GET 命中 cancelled，以及正式付费任务 POST 的确定性 4xx 等不可复用分支，按对应 guard 清理 intent。正式付费任务 POST 及其响应体共用 deadline；该 POST 出现网络/status 0/5xx 未知结果时只按原 key exact GET reconcile，绝不重发付费任务 POST。retry 先保存取得 fresh revision，再由服务端最终 `BEGIN IMMEDIATE` 核验 live canvas/node/kind/taskId/inputKey/attempt/updatedAt；localStorage 写失败在付费前 fail-closed。Workspace create/rename/delete、CanvasShell create/clone/delete 与 UpdateNotice reload-after-save 各自具 in-flight fence 和显式失败处理；Workspace DELETE 与删除后核验所用列表 GET 具 deadline（列表覆盖 response body）。Workspace 删除向 ConfirmDialog 传入 busy，ConfirmDialog 负责 focus/Escape/a11y；CanvasShell 删除依靠外层 fence。

测试运行于功能提交前、HEAD `26ff9396194499365c79e5bc85238631ed44ef7a` 下 403-file 冻结脏工作树 `ce7b4856b00b3ab12ee4853ece0b07b01dec86619bbca7865daa4edb659cc957`：adjacency 12-spec `142/142`、target 10-spec `255/255`、核心 8-spec `repeat=3` 共 `606/606`、安全全量 `109/109 spec、841/841 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=477`；Node `22.23.1` / npm `10.9.8`；源码 286，TS/TSX `270/270`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结；4173 listener 前后均为 `91689b3fefccfb3fe32ffc44e2b10a3146976b76d497183f56f7457924a7e219`。功能提交 `138f7ff0f9481e73355fbd9a9fd2c548ee9cee1a` 包含相同功能文件，未在该 commit 后或文档后树重跑。独立终审无剩余即时产品 P0/P1；本项进入 `USER_REVIEW`，当前切换 REM-008。

上述证据不是用户 PASS、真实 Mureka/真实数据/真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮；`INPUT-006 / AUDIO-REAL-001` 继续 PARTIAL/暂停。REM-007 无 schema 迁移；新增 ownership 是可选 canvas JSON/localStorage 字段，旧数据兼容与最终数据格式矩阵仍归 REM-009B。结论只在单一 active process 前提下成立，F-023 留 REM-010；不宣称跨标签分布式互斥。package `0.5.1`、线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### REM-008：资源、安全、性能和运维脚本

范围：登录限速、SSE 连接/背压、流式导出、上传/磁盘预算、ffmpeg/ffprobe 超时和并发、Provider/OSS 出站保护、安全响应头、依赖安全更新、镜像/密码脚本、媒体缓存和必要的包拆分。资源保护不得通过把视频上限降到 500MB 以下来规避 `DEP-005`；优先使用流式落盘、磁盘配额和并发限制，若要改变 500MB 合同必须先获用户确认。

完成标准：超大请求受控拒绝且内存不随输入线性增长；挂死子进程按时终止；私网/IPv6/DNS 重绑定/重定向全部阻止；压力后内存、子进程、临时文件回落；不进行框架大版本升级或视觉重做。

2026-08-12 离线执行证据：登录使用有界 token bucket 与 fail-fast 密码校验并发，SSE 具全局/每键连接和慢客户端边界；请求体、播放列表、缩略图、上传与生成结果使用受控流式路径和进程/账号/磁盘 reservation，保持 500MiB 视频合同。ffmpeg/ffprobe 具有界队列、deadline、进程组 TERM→KILL 和输出上限；Provider 结果与 OSS 使用私网/保留地址/IPv6 拒绝、DNS pinning、redirect fail-closed。安全头、`nanoid 3.3.18`、密码重置/存储修复 dry-run/apply 合同，以及按需包、历史分页/懒加载和缩略图缓存/URL 回收均完成；真实 OSS mirror/backup-to-OSS 继续冻结。测试运行于功能提交前、HEAD `d63af1224bbadfab00cdd65256c16afaf4195fa1` 下冻结脏工作树 `79625ac9768e99351f00190389a76e19945355405a3235608f219afd4d2d81be`：核心 15-spec `repeat=3` 共 `588/588`，安全全量 `111/111 spec、891/891 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=492`；Node `22.23.1` / npm `10.9.8`；源码 294，TS/TSX `277/277`、JS/MJS `17/17`；12 个运维脚本为 9 个行为验证 + 3 个哈希冻结；4173 listener 前后均为 `09d55bc82aab1e1f04aae60397395befd6d17c41b5b2622bcde7c4c7b1b8ec2`。功能提交 `ff9a2adbb9ba93c9646935b2b22b318fb5503f21` 包含相同功能文件，未在该 commit 后或文档后树重跑。本项进入 `USER_REVIEW`，当前切换 REM-009B。

上述证据不是用户 PASS、真实 500MiB 上传、真实数据/Provider/OSS、浏览器 TLS/生产安全头、生产迁移、发布许可或 REM-011 最终三轮。资源/SSE/进程/出站合同只在单一 active process 内成立，不是跨进程/多机配额；磁盘 reservation 不是 OS 全局配额，修复脚本也不声称文件系统/SQLite 跨介质崩溃原子。F-020/F-024 仍归 REM-009B，F-022/F-023 仍归 REM-010。package `0.5.1`、线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### REM-009A / REM-009B：真正只读的备份、恢复与数据库兼容

REM-009A 在核心持久化修改前完成：建立只读备份、合成库恢复、损坏拒绝、密钥保护和迁移失败恢复底座。REM-009B 当前 `IN_PROGRESS`：用最终候选 schema/数据格式执行双向兼容、桥梁和完整恢复演练。

共同范围：由应用/运维层先冻结写入；备份连接以真正只读方式打开 SQLite，绝不调用 `openAppDatabase`，使用 SQLite 在线备份能力或经验证的 WAL 安全快照；一致复制数据库、媒体、密钥和 OSS 恢复材料，动态表计数与逻辑内容指纹，备份加密、最小权限、独立故障域保存、保留/销毁规则，损坏拒绝恢复，旧/当前/候选 schema 与数据格式演练。

完成标准：源库 user_version 与逻辑内容在备份前后不变，指纹覆盖 WAL 中已提交内容；本地数据库/媒体/密钥可完整恢复；每个 OSS `object_key` 的存在性、版本和校验值可验证，并具备不可变保留、版本控制或对象内容镜像，否则不得声称 OSS 可完整恢复；备份加密且主密钥与备份最小权限隔离；人为损坏任一部分时拒绝覆盖目标目录。

自动合成库可以创建测试账号并执行登录；任何经用户另行授权的生产备份副本验证必须硬断非 loopback、禁用任务处理器/Provider/OSS，不得写入 `__test__` 或其他业务测试行，只做结构、逻辑指纹、解密能力和媒体一致性验证。

2026-08-09 REM-009A 离线执行证据：已完成格式 2 的逐文件 AES-256-GCM 加密、RSA-3072 OAEP-SHA256 密钥包裹与 Ed25519 独立签名；源 SQLite main/WAL/journal 仅复制到私有临时目录后生成快照，绝不调用 `openAppDatabase` 或对源库 checkpoint。检查覆盖 schema37 完整迁移账本、19 张业务表与 `sqlite_sequence`、schema/行级逻辑指纹、integrity/FK、三类密钥文档真实解密、本地已登记/孤儿媒体及带 versionId/checksum 的假 OSS 内容镜像。所有输入、密钥、包与工作目录具备可信父链、owner/mode/inode/nlink 约束；创建/恢复使用独占 reservation、不可覆盖发布和 incomplete marker，readiness 对任何残留 marker fail-closed。带 object_key 的非 ready OSS 行、损坏签名/manifest/任一密文、外来目录项和中途故障均拒绝发布。专项 m10 `9/9`、最终快照三轮 `27/27`、安全全量 `105/105 spec、542/542 PASS`，失败、跳过、retry、report error、blocked 均为 0；TS/TSX `262/262`、JS/MJS `15/15`；两路独立终审无 P0/P1。schema `37` 与 package `0.5.1` 不变，本地功能提交 `ee998db80414cabb211fdc590712a0c257a25e50`。本项进入 `USER_REVIEW`，当前切换到 REM-003。

### REM-010：不可变发布、切换与回滚系统

范围：干净且固定 SHA 的 release 包、锁文件安装、版本化目录、构建产物哈希、待命/只读模式、单任务处理器、请求排空、三层健康检查、跨版本数据格式兼容矩阵、nginx 原子切换、旧 release 保留、push/tag/部署步骤分离。

完成标准：在临时“假服务器”中完整模拟构建失败、健康失败、迁移失败、nginx 失败、切换与回滚；任一失败不影响旧服务；发布包无 `.env`、真实数据、测试结果或密钥。

### REM-011：候选版本全量验收与正式发布门

范围：全部自动测试、三轮全新环境、并发与故障注入、备份恢复、发布回滚演练、用户本地候选页验收、文档收口。

完成标准：G0～G7 全绿；所有受影响项经用户确认；用户分别确认正式版本号和允许发布。未获这两个授权前，不连接生产主机。

## 8. 全量测试绿灯 G0～G7

### G0 安全隔离

- 临时数据路径是本轮新建的系统临时目录；
- 路径不等于也不位于 `app/data`、`/var/lib/unboundry`、仓库 backups；
- 动态端口不等于 4173，4173 PID 前后相同；
- 真实路径 denylist 与文件访问审计证明任何测试子进程都没有打开、stat 或哈希真实数据库；
- 真实凭据读取、非 loopback 网络、由施工/测试产生的线上读写请求、真实 Provider 请求均为 0。

### G1 可重复构建

- REM-001 已决策并记录的精确 Node 22/npm 版本；
- 全新隔离 checkout 按锁文件安装；
- TypeScript、MJS/JSON/CSS 检查和生产构建通过；每个 Git 跟踪的 TS/TSX 文件都必须被主检查覆盖，或有明确排除理由与独立检查证据；
- 无可达高危依赖，或由用户明确接受残余风险；
- 测试证据和发布产物绑定同一 Git SHA。

### G2 完整自动测试

- 原始基线 105/105 spec、519/519 既有测试已全部纳入；REM-001 后为 520，REM-002 后为 536，REM-009A 后为 542，REM-003 后为 107/687，REM-004 后为 109/762，REM-005 后为 109/790，REM-006 后为 109/804，REM-007 后为 109/841，REM-008 后当前为 `111/111 spec、891/891 tests`；新增测试必须自动纳入且执行数必须等于发现数；
- 失败 0、skip 总数 0、fixme 0、only 0、依赖 retry 才通过 0；真实 OSS/Provider 外部验真移出离线清单，以本地假服务替代逻辑覆盖；
- 逐文件隔离全量与关键组合回归均通过；
- 真实 OSS/Provider 验真不伪装成离线门禁，使用假 OSS/Provider 覆盖逻辑。
- 生产构建中不存在可访问的故障注入 API；测试 bypass/假 Provider/并发屏障只能在显式测试模式和系统临时数据目录启用，preview/生产模式发现相关变量必须拒绝启动，并回归 `DEP-009`。

### G3 稳定性与故障注入

- 完整全量在三个全新临时环境连续通过；
- 关键竞态使用确定性屏障并至少压力复跑 20 次；
- 覆盖保存乱序、上传中断、取消/完成竞争、Provider 挂起、OSS 断线、ffmpeg 挂死、备份失败；
- 无僵尸进程、残留端口和本轮临时目录。

### G4 备份恢复

- 当前和旧 schema 合成库恢复通过；
- 候选迁移失败恢复通过；
- 数据库、媒体、密钥、manifest 损坏均会拒绝恢复；
- 恢复后的登录、画布、媒体、任务和测试凭据解密通过。

### G5 发布回滚演练

- 按“桥梁已就绪/未迁移”“静态维护”“迁移后只读”“恢复写入后”分别验证回滚，不笼统承诺每个阶段动态旧版都可访问；
- 正常服务阶段请求完成率 100%、连接重置 0、超时 0、响应体/版本正确、延迟不超过演练阈值；静态维护阶段页面返回预期 200，动态 API 可按计划返回 503 + `Retry-After`，不得被误判为发布故障；
- 回滚后画布写入和媒体读取正常；
- 编排中的 Git push、tag、SSH 和生产切换全部为假实现；生成的 nginx 配置必须在本地可用的同版本/同模块环境做真实 `nginx -t`，systemd unit 做真实静态校验，生产核验仍等待发布授权；
- 在途保存只允许以同一幂等请求恢复且最终不丢数据；只允许幂等 GET 自动重试，绝不自动重试 POST。

### G6 用户验收与文档

- 每批给用户通俗的手动验收清单；
- 文档/工程证据完成进入 USER_REVIEW，实页产品行为进入 USER_RECHECK，用户确认才 PASS；
- `TASKS.md`、验收矩阵、施工断点同步；
- 真实 Provider、真实 OSS 公网兼容等未执行范围明确保留为未验证。

### G7 发布授权

- 普通未提交批次先绑定“HEAD + 完整 diff 哈希”；进入 REM-011 前必须单独申请本地候选 commit 授权，获准后固定 SHA，并从干净隔离 checkout 重跑 G0～G6；未获 commit 授权不得宣称 G1/G7 通过；
- 备份与回滚方案完整；
- 用户明确确认正式版本号；
- 用户随后明确确认允许发布；
- 此前不 commit/push/tag/SSH 修改/发布，除非用户对相应动作有独立明确授权。

依赖准备与测试断网分开：REM-001 必须记录准确 npm 版本并优先准备锁定缓存，门禁使用 `npm ci --offline`；若缓存缺失，需要访问公共 npm registry，先向用户单独说明并获授权。Provider/OSS/生产域名在任何阶段都不因依赖准备而放行。

## 9. 数据库与发布决策

### 9.1 优先保持 schema 37

每个修复先评估能否复用现有表、事务和状态。不能为了实现方便随意加迁移。但“仍是 v37”不等于一定能回滚：还必须证明 `v0.5.1` 能安全读取和回写候选版产生的画布 JSON、任务快照、媒体状态/命名、配置与加密 AAD，不会丢弃未知字段或误处理状态。只有 schema 和数据格式兼容矩阵都通过，才允许把 `v0.5.1` 作为回滚目标；否则即使不升 schema，也必须使用兼容桥梁版本。

REM-004 评估后确认持久媒体发布/删除 journal 属必要 P0，形成 schema 38 离线候选；REM-005 为原子付费边界、凭据 epoch 和 admission 账本追加 schema 39，当前离线候选为 schema 39。该结果不改变生产 v0.5.1/schema 37；v0.5.1 会拒绝候选库，迁移后不得直接以 v0.5.1 回滚。

### 9.2 schema 或数据格式不兼容时

必须先有一个“兼容桥梁版本”，而且桥梁必须在任何数据库迁移之前完成全部验证并先成为线上可用的回滚目标：

- 能识别 v37 和候选 schema；
- 启动与迁移分离，默认不会因健康检查自动迁移；
- 支持待命、只读和单任务处理器；
- 能完整读写候选库的画布 JSON、任务状态/快照、媒体文件与对象键、session/Cookie、配置和 secret AAD；桥梁回写不得丢弃候选版字段；
- 可作为升级后回滚目标。

旧版 `v0.5.1` 遇到未知迁移会拒绝启动，因此数据库升级后不得声称可以直接切回 `v0.5.1`。

REM-009B/010 的新增硬门为：用富含业务数据、媒体、secret 和假 OSS 的冻结 v37 格式 2 包完成 create → verify → restore → migrate → start；提供迁移后退出、不会成为 active 服务的一次性 exact-v37→schema39 maintenance migration；获取写锁后在同一锁内重新验证来源合同，关闭 TOCTOU；覆盖中间 schema 38/39、checksum/duration 回填和 credential/admission 高水位的故障恢复；证明 v37/v39 runtime bridge 和 v0.5.1/候选双向数据格式矩阵。migration 39 的 admission 表故意不从历史任务推断回填，因此发布前必须冻结新生成、排空活动任务，并从最后一次可能 Provider admission 起持续至少 60 秒，再迁移并只启动唯一 active worker。若不兼容，严格执行两个版本号和两次独立生产授权。当前 exact-v37/v38 格式 2 round-trip 与显式迁移角色只是离线结构证明，不是生产迁移或回滚证明。

发布策略首选是：候选版对 `v0.5.1` 的 schema 和数据格式保持完整双向兼容，只做一次最终发布。如果做不到，桥梁版本运营上就是一次额外正式发布：需要自己的版本号、完整演练和单独生产授权；最终候选版又需第二个版本号和第二次生产授权。未向用户讲明并获得这“两个版本、两次发布授权”前，不得偷偷发布桥梁，只能延后不兼容改动。

### 9.3 正式切换顺序

1. 用户已经分别确认版本号、发布窗口和“允许连接生产并发布”；
2. 先在旧服务入口全局阻止所有 mutation（包括登录/session、保存、上传、删除、生成、取消、密码、账号、模板、项目、Provider/存储配置），并停止后台写者；
3. 等 `queued / running / retrying / recovering` 等所有活动任务为 0，并排空保存、上传、导出等在途请求；冻结新生成后，还必须从最后一次可能 Provider admission 起至少 60 秒无新 admission；不能取消、重复或带活动任务强切；
4. 旧 SSE 先发送维护/切换事件后主动结束，浏览器必须重连并确认进入新版；nginx 与应用两层统计上传/请求，长 GET/Range 有明确截止策略；
5. 首次从 `v0.5.1` 切换时，nginx 改为静态维护页；受控停止旧动态服务并抑制 systemd 自动拉起，确认没有后台任务或数据库写入；此时不承诺已有内容仍可查看；
6. 由应用/运维层保持写冻结，使用不调用 `openAppDatabase` 的只读 SQLite 备份连接制作一致备份并校验；
7. 在临时目录恢复并启动验证；
8. 如需迁移，此时执行显式迁移；桥梁版本必须已经在迁移前成为可用回滚目标；
9. 新版以单一正式写入者启动并完成数据库/业务就绪检查；
10. nginx 配置校验后原子切换到新版，禁止自动重试 POST；
11. 保持短时间只读观察；
12. 用户和自动检查确认后恢复写入与生成；
13. 旧 release 和备份继续保留；候选必须同时保留 N-1 不可变静态 assets（或等价共享资源），避免旧标签页请求旧 hash JS/CSS 时 404；没有通过跨版本数据格式矩阵的旧版本不得重新连接真实库。

### 9.4 回滚铁律

- 尚未迁移：放弃候选，旧版继续；
- 已迁移但尚未恢复写入：切兼容版本，必要时恢复迁移前备份；
- 新版已经允许用户保存：不得恢复升级前备份，否则会抹掉新数据；只能切到能读新库的兼容版本或向前修复；
- 不得让新旧两个版本同时作为真实数据库写入者或同时处理真实生成任务。

已上线迁移 v1～v37 视为不可变历史：不得改版本号、改名或修改既有 SQL，只能追加新迁移。SQLite 事务之外的文件、OSS 或 secret 迁移必须有持久 journal、幂等重试和补偿，不能把数据库 rollback 误称为完整回滚。standby 就绪检查全程只读，不得迁移、回填或初始化 taskStore；active 就绪检查可验证 schema、数据目录、密钥可用性和写锁能力，但不得初始化 taskStore、创建业务测试行或请求 Provider。

## 10. 每批交付证据包

每个 REM 项完成时至少提供：

1. 本批修复内容与明确未做内容；
2. 对应文件、Git SHA 和差异摘要；
3. 使用的临时数据目录、动态端口及清理结果；
4. 4173 PID 未变化、真实路径 denylist 与文件访问审计证明测试子进程未访问真实路径的证据；
5. 测试发现数、执行数、通过/失败/跳过数；
6. 非 loopback 网络和真实 Provider 请求为 0 的证据；
7. 关键并发或故障注入结果；
8. 必要的截图、trace、数据库前后对比；
9. 用户手动验收步骤；
10. TASKS、验收矩阵和断点的同步差异；
11. 仍未解决、外部未验证或明确延后的边界。

## 11. 上下文压缩/换 Agent 恢复协议

恢复时必须按顺序：

1. 阅读仓库根 `AGENTS.md`；
2. 阅读 `README.md`；
3. 完整阅读本文件；
4. 完整阅读 `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；
5. 阅读 `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`；
6. 阅读 `TASKS.md` 当前 REM 区块和验收矩阵 REM 区块；
7. 只读核对 `pwd`、分支、HEAD、工作树、package 版本、Node 版本；
8. 对照断点确认当前唯一 IN_PROGRESS、上一步证据和下一步授权；
9. 向用户输出简短恢复报告；
10. 任何不一致均停止，不得猜测继续。

恢复报告固定包含：项目/线上版本、分支/HEAD、脏文件、当前 REM、最后完成项、下一步、当前授权、真实数据/Provider/发布状态。

## 12. 决策门

| 决策 ID | 何时需要 | 默认状态 |
|---|---|---|
| DEC-REM-001 | 用户确认本施工文档成为权威合同；REM-001～011 的实施授权仍需另行确认 | 已确认（2026-08-09）；离线实施授权也已同日确认 |
| DEC-REM-002 | 是否允许建立仅本地 checkpoint commit（绝不 push） | 已确认：允许本地 checkpoint、功能和 candidate commit；绝不 push/tag/PR |
| DEC-REM-003 | 账号删除继续遵守 PERM-011，或明确以新公共模板/授权/审计/tombstone 合同替代并重新验收受影响 PASS；KEY-008、AUTH-006 不得回退 | 已确认：沿用 PERM-011；公共模板及必要素材转交受保护最高权限账号；其他私有数据按既有合同安全清理 |
| DEC-REM-004 | 首选保持 v0.5.1 双向兼容并只发布一次；若 schema 或数据格式不兼容，用户选择“桥梁+最终版两次发布，分别确认两个版本号和两次生产授权”或“推迟不兼容改动”；不得绕过桥梁直接升级 | 已确认：REM-004 必要 P0 形成 schema 38，REM-005 追加 schema 39，当前仅为 schema 39 离线候选；生产仍 HOLD，REM-009B/010 必须先完成桥梁、迁移、回填故障、60 秒 admission 排空与双版本矩阵；生产授权另议 |
| DEC-REM-005 | 正式候选版本号 | G0～G6 全绿后确认 |
| DEC-REM-006 | 是否允许连接生产主机并发布 | 版本号确认后另行确认 |

## 13. 当前外部验收边界

以下既有状态不因本计划建立而改变：

- `DEP-003` Secure Cookie 浏览器确认仍为 PARTIAL；
- `DEP-005` 真实 500MB 公网上传仍为 NOT_STARTED；
- `DEP-006` OSS 旧备份自动清理仍受 RAM ListObjects 权限限制；
- `DEP-007` 公网真实生成仍为 PARTIAL；
- `DEP-010` 部署文档与剩余验收仍为 PARTIAL；
- Mureka 真实生成和其他已 PAUSED/PARTIAL 项保持原状态。

## 14. 本轮定义完成

本轮只有同时满足以下条件才算完成：

- REM-000～REM-011（含 REM-009A/009B）中用户批准纳入的范围全部达到对应状态；
- G0～G7 全部满足；
- 没有把真实外部未验证项虚报为 PASS；
- 用户确认最终版本号与发布；
- 发布后业务健康、数据一致性和任务状态正常；
- TASKS、验收矩阵、交接和施工断点完成最终收口。

## 15. 变更记录

| 日期 | 版本 | 变更 | 授权 |
|---|---|---|---|
| 2026-08-09 | 1.0-draft | 根据全量审计与三路方案复核建立施工合同 | 用户仅授权先做施工文档，待复核 |
| 2026-08-09 | 1.0-draft.2 | 纳入三路独立文档复核：拆分备份前置/最终演练，收紧账号删除合同、测试覆盖和首次切换，明确桥梁意味两次单独发布授权 | 用户仅授权先做施工文档，待复核 |
| 2026-08-09 | 1.0 | 用户明确回复“施工文档确认通过”，REM-000 正式收口 | 用户已确认文档；不自动授权后续施工 |
| 2026-08-09 | 1.1-offline | REM-001/002 离线工程候选收口；登记 F-035～F-047、105/536 全量证据与 REM-009A 当前断点 | 用户已授权一次性离线 Goal；仅本地工程，不含生产/发布 |
| 2026-08-09 | 1.2-offline | REM-009A 加密只读备份、验签、恢复和损坏拒绝底座收口；登记 F-048～F-053、105/542 全量证据并切换 REM-003 | 用户已授权一次性离线 Goal；仅本地工程，不含真实数据/生产/发布 |
| 2026-08-09 | 1.3-offline | REM-003 加载/保存基线、每标签高水位、DATA-005、持久草稿与生成门禁收口；107/687 全量证据并切换 REM-004 | 用户已授权一次性离线 Goal；仅本地工程，不含真实数据/生产/发布 |
| 2026-08-11 | 1.4-offline | REM-004 原子媒体发布、补偿恢复、ready-only、权威尺寸、adoption ACK 与完整性报告收口；109/762 全量证据并切换 REM-005；schema 38 仅离线候选 | 用户已授权一次性离线 Goal；production HOLD，不含真实数据/生产/发布 |
| 2026-08-11 | 1.5-offline | REM-005 原子 admission、owner-scoped 幂等、最终付费闸、credential epoch、未知结果保护、deadline、持久队列与 abandon 收口；109/790 全量证据并切换 REM-006；当前 schema 39 仅离线候选 | 用户已授权一次性离线 Goal；production HOLD，不含真实数据、真实 Provider/OSS、生产或发布 |
| 2026-08-11 | 1.6-offline | REM-006 账号删除可重试 saga、模板/媒体转交、权限/凭据、Provider/catalog/存储变更的 actor fence 与审计线性化收口；109/804 全量证据并切换 REM-007；schema 39 仅离线候选 | 用户已授权一次性离线 Goal；production HOLD，不含真实数据、真实 Provider/OSS、生产或发布 |
| 2026-08-12 | 1.7-offline | REM-007 四类持久 ownership/exact GET/旧预览/terminal ACK、transport/retry/localStorage fail-closed 与 Workspace/Update/ConfirmDialog 失败体验收口；109/841 全量证据并切换 REM-008；无 schema 迁移 | 用户已授权一次性离线 Goal；production HOLD，不含真实 Mureka、真实数据、真实 Provider/OSS、生产或发布 |
| 2026-08-12 | 1.8-offline | REM-008 登录/SSE、媒体资源、进程池、Provider/OSS 出站、安全头、依赖、运维脚本和必要性能治理收口；111/891 全量证据并切换 REM-009B | 用户已授权一次性离线 Goal；production HOLD，不含真实 500MiB 上传、真实数据、真实 Provider/OSS、生产或发布 |
