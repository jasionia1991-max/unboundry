# Unboundry Canvas Document Write Boundary 实施 Checkpoint

状态：`V0_7_9_DEPLOYED_SCHEMA43 / R9_PASS / R10_REFRESH_NO_GO / REAL_CLICK_0_OF_1 / RELEASE_AND_REAL_PROVIDER_AUTHORIZED`

## 最新完成：v0.7.10 冻结候选正式全测（2026-09-05）

- 发布前最终回填：同一独立Reviewer已完成post-full文档delta7/7、全部after-SHA匹配、产品/测试变化0，P0/P1/P2=0/DOCUMENT_GO；其确认此前引用外层路径只是笔误，并在正确实施树重验legacy SQL/sweep。维护方案revision4条件性设计GO，精确runbook仍须执行前复核。现在进入0710 commit/push/PR/CI；下方待审字样保留为此前时点，不重复full。

- 上一Goal turn为verified wait：仅轮询同一正式full handle37186。当前turn完成实际全测并新增只读生产预检和有界回滚设计修正，不是重启测试或重复旧状态。
- 候选基线`b73f402ef27b616e041eb5088fd2937b227ab4ca`、branch`codex/v0.7.10-canvas-read-deadline`。独立Review完整覆盖158/158文件、1969/1969hunks、writer256/256、CWB194/194；不变的10模型/12identity/6adapter已逐分支审查并明确复用。P0/P1/P2=0，遗漏0；当前21文件/231hunk增量全部审查。冻结inventory SHA=`1bebe69e48ad23aed4fca023b813fdec51df5a77b69622d62dcf6b1f017aa88a`。
- 唯一正式命令`/Users/mymy/.hermes/node/bin/node scripts/run-safe-tests.mjs full`，session37186已terminal exit0：127specs、1239/1239PASS、failed/skipped/retries/blocked/reportErrors0，Node22.23.1/npm10.9.8，source/snapshot=`676ea9bc69eb4051a64b7abe32235c5cbd38f1ae9481370964a53ac5ece6e37b`、4173 listener unchanged，临时suite清理完成。测试结束、编辑文档之前再次只读核验158文件hash漂移0。
- formal原始分段与完整最终聚合保存`/tmp/unboundry-v079-runtime-drill.YqH6MK/`；早期部分工具输出被截断，不声称原始逐行日志全量，但最终聚合完整。`formal-full-final.json`是本次完整结果摘要。文档only更新不使业务证据失效，不重跑full。
- 三份新恢复副本真实进程079/43→077/42→079/43全部PASS，verify/fresh restore绑定、ready/version/schema、网络namespace零成功外联、优雅exit0、子进程0/端口释放全部通过；旧42所有表不变，43副本仅既有恢复投影改4表且业务计数不变。回执原文与SHA见生产079receipt补充。不能升级为真实service回滚通过。
- 生产07:21–07:28 UTC只读预检：当前release079/PID395702/NRestarts0/schema43；task1064/admission984/attempt1075/run7/media979/publication570/receipt2，targetrevision84/input58。active/unknown/unsettled/run/publication0，删除/未adopt上传清理/projection candidate0。既有legacy sweep mode=allowlist、3Canvas，完整任务筛选为0/2/0，潜在绑定0/0/0；不擅自关闭既有配置。正式维护仍需stop后重验，不能用该采样代替freeze。
- 维护方案在工作树外独立有界复核：失败只回滚code/unit到079，始终保留当时live43，不回灌旧42/43；临时实际service077只读权威备份的新42副本且网络隔离，公网停服明确。前置候选0、逐表主键/行hash和用户字段无损门已补；最新legacy-sweep零潜在绑定delta仍待复核。`LIVE_SERVICE_ROLLBACK_FORWARD_PLAN.md`与`V0_7_10_RELEASE_AND_MAINTENANCE_RUNBOOK.md`均不是已执行证据。
- Goal自有图/视频/音频fixture已生成并解码校验，路径`/tmp/unboundry-v0710-acceptance-fixtures.Ipz2dv`；上传0、Provider0。既有素材OSS只读GET/Range允许并单列，新生成/上传/写仍0硬门。
- **下一动作**：完成本次文档增量与维护设计复核；0710 commit/push/PR/双CI/immutable tag/Release/exact-tag build，然后latest43 locked-exact备份恢复与已审查维护rollback-forward。随后完整cold/warm三方0写门、唯一目标group、音频/三类上传/下游输入、结果后刷新和最终生产全量复核。生产/真实生成仍未通过，Goal保持active。

以下“未冻结/未full/未进程演练”均为以上最新证据之前的历史记录，保留失败与顺序，不作为当前下一动作。

## 本地读取修复断点（2026-09-05，优先于下方历史时点）

- 最新完成：精确0.7.10版本登记经独立设计Review（P0/P1/P2=0/DOCUMENT_GO）后已实施；m81原用例新增精确final、角色冲突、未知0.7.11、hotfix/build/v前缀拒绝断言。safe m81 42/42+m38 19/19=61/61 PASS，exit0，failed/skipped/retries/blocked/reportErrors0，source=`9ee02c0b43423af892317421793cc157f2914685ba4e9eb5d8bcce4126f4f44f`，4173不变。现有定向208项，不是formal full。版本启动P1已由实际Vite启动及定向证据关闭；最终候选Review仍未运行。
- 下一安全动作：完成`/tmp/unboundry-v079-runtime-drill.YqH6MK/driver.mjs`及runtime-stage.mjs的独立操作安全复审后，在新隔离恢复副本执行逐阶段真实进程演练。当前只新增脚本与Node语法验证，未上传或执行；副本证据不代替live rollback，所有用户数据必须保留。

- 最新失败已确认：版本化后safe m38在重启持久化预检阶段退出1，原因是运行时精确版本白名单漏登记0.7.10，m38产品spec尚未运行；snapshot=`dbb4e57158f472adc75b4ac9dd16ae7d35c8d5aee217039f4eed7a28af52f534`，4173监听不变。Plan已登记最小白名单补丁及m81/m38验证，先做独立文档复核，不把此前147项当作新版启动通过。

- 最新版本元数据：已将package/lock三处版本更新为0.7.10，并同步current-state/AGENTS实际生产079与候选0710路由；旧业务定向证据保留，未复用为候选formal full。发布物、生产服务和真实点击均未改变。

- 最新补证：m22工作流直接依赖45/45、m105写入清单1/1通过，failed/skipped/retries/blocked/reportErrors0、exit0；source=`4398cd959dc5c4390514bb94d58b32f7c2844ce78903da82a85e8e52f3e1a8cb`。合并此前可复用m3/m86共147项有效定向PASS。未重跑formal full。
- Linux namespace预检：普通ubuntu执行bwrap失败；sudo bwrap创建mount/PID/network/IPC/UTS namespace后setpriv降至UID/GID1000已验证可执行。恢复演练方案及控制脚本在`/tmp/unboundry-v079-runtime-drill.YqH6MK/`接受独立操作安全审查；尚未启动恢复副本，不把预检等同恢复PASS。

- 上一Goal turn为进展：用户只读素材口径已进入Plan/Matrix/receipt，并完成有界超时诊断。本turn已经实施修复，不再停在未执行计划。
- branch=`codex/v0.7.10-canvas-read-deadline`，base HEAD=`b73f402ef27b616e041eb5088fd2937b227ab4ca`；v0.7.10本地/远端tag空、GitHub Release404。package仍0.7.9，下一版本尚未冻结/版本化/发布，不得改既有v0.7.9发布物。
- Plan R10补充经同一独立Reviewer取得`P0/P1/P2=0/DOCUMENT_GO`后实施：四个Canvas读取入口共用`loadCanvasPersistenceWithDeadline`，30秒覆盖headers+body，abort即使被底层忽略也结束调用；transport先检查abort再更新authoritative cache。保存截止仍6秒，无新GET重试/Provider/写入通道。
- 自动化首轮在产品测试前分别因库存新增10项、runner目标hash过期停止，均已如实更新库存1239及对应hash。第一次产品定向执行101项，98通过/3失败：2项新增external用例误用了clean-page reload路径，1项旧hung-GET仍等5秒。只修测试fixture和虚拟时钟后，最小可选m86复验87/87、failed/skipped/retries/blocked/reportErrors0、exit0；m3原14/14证据复用，未重跑它或formal full。有效定向覆盖101项。命令/失败/源码hash详见新回执。
- 新回执：`spec/V0_7_10_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-05.json`；m86最终source SHA=`9c843282947df405458df1d319fcd8566504cef72829529429682381023a7661`。writer清单256 entries、0 violations已刷新。
- 生产只读重验：v0.7.9/schema43、active、PID395702、NRestarts0。本turn未改生产代码、未写生产数据、未点击生成；后台既有恢复不计为本turn请求，也不声称全站静默。
- 独立回滚调查确认：Linux已有bwrap/unshare，现有通用脚本无exact079/43→077/42→079/43实际进程证明；当前部署没有`release-manifest.json`，使用exact-tag生产回执与`RELEASE-INVENTORY.sha256`，不能套用要求manifest的旧runner。实际ExecStart已核对为Node22+Vite preview/configLoader runner；演练须独立新恢复副本、真实网络namespace、动态loopback，绝不绑定live data/current pointer/4173。只读probe不能冒充完成，schema43新写不得丢失。
- 下一安全动作：m22直接工作流依赖与m105清单验证；补独立故障/回滚方案及完整进程恢复证明。然后版本化、冻结独立Review、唯一新formal full、发布/部署并重做cold/warm三方门；之后仍须一次目标组、音频、三类上传与最终全量生产复核。生产NO_GO不能因本地101项PASS而升级。

## 当前断点覆盖层（2026-09-05）

- 用户最新澄清“允许已有素材只读加载”：冷刷新既有4图+1视频的5个OSS GET不再构成合同阻断，Plan R10.11与CWB-185已同步；不修改原始Goal附件，原始失败观察和审查保留为历史证据。暖刷新3秒abort仍是当前真实NO_GO，不能因澄清就升级PASS。
- 同一Reviewer已完成有界诊断复核：3秒读取截止在v0.7.7已存在，不能归因于v0.7.9回归，也不能声称回退旧版会解决。建议下一patch集中采用30秒Canvas只读截止，覆盖初始hydrate、admission权威读取、workflow结果refresh、external baseline；保存截止6秒与abort/迟到响应隔离/journal保留/禁止重复提交均不改变。需分别验证6秒延迟成功和30秒挂起失败关闭。尚未修改产品或发布下一版本。
- 服务器6秒延迟来源尚未证实：Provider配置db()为进程缓存，不能把10模型查询误算为10次open；恢复schema43副本的只读quick_check为24ms、FK检查19ms，只是局部诊断，不构成生产请求分段性能证据。当前生产验收仍NO_GO，不能用延长客户端截止冒充服务器性能根因已解决。
- 回滚边界未解决：schema43已有历史恢复/投影的新写，禁止覆盖或伪降级；v0.7.7只能配schema42精确备份。完整进程rollback-forward仍需补证，不能把只读probe升级为通过。

- 前一 Goal turn 有实际进展：PR #158/Release、schema42→43 唯一正式 migration、两份 encrypted backup/verify/fresh restore、原子切换与恢复 generation safety 已完成。服务当前 active/enabled、PID395702、NRestarts0；下面历史阶段账本尚写生产 v0.7.7 的句子不再代表当前。
- 本 turn 补齐：GitHub/live identity、33/33 dist files 公网和回环逐字节一致、备份 key/rollback 父目录权限恢复0700；恢复副本上的 v0.7.9/schema43→v0.7.7/schema42→v0.7.9/schema43 只读 runtime probe 均成功且副本 bytes 不变。该 probe 不是完整进程启停回滚演练，不得冒充 CWB-192 已通过。
- 冷刷新 05:10:01Z 开始，4 images complete/video readyState4、无 alert；05:10:31Z 确认稳定至05:11:21Z无新网络。目标 revision84/input58、task1064/admission984/attempt1075/run7不变。浏览器存在4个OSS GET200+1个GET206；最早导航buffer出现截断（Canvas GET及之后记录仍在），所以不能宣称完整刷新硬门PASS。
- 暖刷新 05:11:21Z 开始，Canvas GET `93268.121` 在3.001秒被前端abort；服务端 `b58cfd46-fa57-483a-94ff-4f2dba9d90a2` 约6秒后HTTP200、handler2ms，页面显示“画布加载失败”。`CanvasSurface.tsx` 的 `PERSIST_LOAD_TIMEOUT_MS=3000` 与 facade 的 abort deadline 已定位；延迟来自网络、进程阻塞或其他共享路径仍须定因，不能直接断言版本回归。
- 前次独立有界审查历史结论为P0=1/P1=0/P2=1/NO_GO：OSS字面冲突已由用户澄清解决，重复音频/上传授权已按Goal修正文档；本次超时复核仍因真实暖刷新失败而NO_GO，不是最终候选或生产全量Review。
- 当前没有费用权限缺口。真实group click0、Goal新增Provider POST0、OSS写0。读取现有素材的GET有明确非零证据；历史task自动结果恢复仍在运行，其Provider只读请求没有完整计数，不得写“所有Provider请求0”。
- 最新回执：`spec/V0_7_9_PRODUCTION_RECEIPT_2026-09-05.json`。下一步：按上述窄范围制定下一patch与无数据损失的回滚处理，补完整rollback-forward，然后重新获取完整三方刷新证据。通过前不得真实点击；之后还需音频、三类本地上传、结果后刷新和最终全量生产证据Review。没有相关代码变化时不要重复已通过的formal full。

更新日期：2026-09-05

配套方案：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_DECOUPLING_PLAN_2026-09-03.md`

配套矩阵：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_ACCEPTANCE_MATRIX_2026-09-03.md`

Writer manifest：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_WRITER_MANIFEST_2026-09-03.json`（`295` source files / `256` raw hits / `200` product hits / `95` exceptions / `0` violations）

## 1. 最新授权

- 用户通过当前 `/goal` 明确授权完成 R0-R10、CWB-001..194、代码/测试/文档/必要 schema migration、GitHub 发布、生产备份/恢复/回滚、普通 Chrome 验证、真实 Provider/OSS 与费用。
- `v0.7.8` 已发布且因生产迁移 preflight 缺陷保持不可变；按 Goal 的失败递增规则，当前修复版本固定为 `v0.7.9`，不得覆盖既有 tag、Release 或 release 目录。
- 只允许操作本 Goal 新建的验收对象；既有用户 Canvas、媒体、任务、账单证据和历史数据不得删除、覆盖或清理。
- 目标 Canvas：`adcb89a5-c1f4-47e4-bbbb-28fff8d81583`；目标 group：`group-17ee0cbc-cc81-4b35-9c5e-41040f627033`。真实点击前必须先通过冷/暖刷新零写硬门。

## 2. 永久保护边界

以下两份文件禁止 read/stat/hash/copy/move/modify/delete/stage；所有扫描、diff、测试和 Git 路径必须显式排除：

- `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`
- `spec/public-templates-director-split-revision.json`

本 Checkpoint 建立前没有主动访问上述文件；Git 工作树检查采用显式 pathspec exclusion。

## 3. 启动身份冻结

### 3.1 实施工作树

- shell 初始 cwd：`/Users/mymy/Documents/unboundry`（仅为外层目录，不是实施工作树）
- 唯一实施 Git root：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`
- baseline branch：`codex/v0.7.7-production-receipt`
- baseline HEAD：`a401016607f1b01b2c266caa786d61734d64b545`
- implementation branch：`codex/v0.7.9-schema43-terminal-history`
- target package version：`0.7.9`（v0.7.8 已发布但未部署；按 Goal 顺序递增）
- origin：`https://github.com/jasionia1991-max/unboundry.git`
- baseline package：`0.7.7`
- default Node/npm：`25.9.0 / 11.12.1`
- tracked changes（排除永久保护文件）：0
- staged changes（排除永久保护文件）：0
- untracked（排除永久保护文件）：仅 Plan 与 Matrix 两份既有方案文件；其 SHA-256 与 Goal 给定值一致。

### 3.2 方案文件启动 SHA-256

- Plan：`85512a47eb63b506ca9e81d3d3d0b092f185645b637bb760230d1a067badfb71`
- Matrix：`851c90e2d3eb768e9b20e44c5683f598c20ab1aba71353140ce8ea45acff7039`

### 3.3 当前生产只读身份

2026-09-03 启动时从公网只读端点核对：

- `GET /api/version`：HTTP 200，`version=0.7.7`
- `GET /api/health/live`：HTTP 200，`status=live`
- `GET /api/health/ready`：HTTP 200，`status=ready`、`mode=active`、`mutationsAccepted=true`、`activeLeaseHeld=true`、`runtimeRole=active`、`schemaVersion=42`

当前只证明公网版本、运行角色和 schema；生产 commit/service PID/release symlink 将在 R0 只读 SSH 冻结时交叉核对。`ready` 不代表 Canvas/workflow/Provider 验收通过。

## 4. 权威恢复完成度

- [x] `AGENTS.md`
- [x] `上线规矩.md`
- [x] `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部当前区块
- [x] `spec/V0_7_7_PRODUCTION_RECEIPT_2026-09-03.json`
- [x] Plan 全文
- [x] Matrix CWB-001..194 全文
- [x] 建立本唯一实施 Checkpoint
- [x] 当前阶段源码、测试与 writer manifest 全量盘点

## 5. 阶段账本

| 阶段 | 状态 | 当前证据 | 下一门 |
|---|---|---|---|
| R0 身份/manifest/预期红 | `TARGETED_PASS` | 唯一工作树/branch/baseline/生产起点已冻结；当前 writer manifest `295/256/200/95/0`；v0.7.7 refresh 被动写入事实已留档 | 候选 hash 冻结 |
| R1 合同/纯函数 | `TARGETED_PASS` | ownership descriptor、document/input 双 fingerprint、revision/no-op/DATA-005/idempotency 定向测试通过 | 独立 Review |
| R1.5 receipt/schema | `TARGETED_PASS` | schema42 能力门判定不足；独立 schema43 附件 Review `P0/P1/P2=0`；42→43、约束、receipt、backup/restore/downlevel 测试通过 | 独立实现 Review |
| R2 gateway | `TARGETED_PASS` | `m104-canvas-command-gateway 12/12`，command/receipt/transaction/HTTP/negative parser/atomic replace-edge 通过 | 独立 Review |
| R3 projection/legacy | `TARGETED_PASS` | generation projection、legacy reconciliation、lost-response/restart/transaction 定向层通过 | 独立 Review |
| R4 client controller | `TARGETED_PASS` | `m3 8/8`、`m84 3/3`、`m86 83/83`；clean/passive/dirty/rebase/pagehide/navigation/load safety 通过 | 独立 Review |
| R5 user writers | `TARGETED_PASS` | Text/四媒体上传/Group/Playlist/imageTools/copy/history/layout/拓扑定向层通过 | 独立 Review |
| R6 passive media | `TARGETED_PASS` | Image/Video/Audio passive event 0 durable write；长延迟、缓存/错误、measurement 路径定向层通过 | 独立 Review |
| R7 generation/legacy exit | `TARGETED_PASS` | single/group/fake Provider/slow/lost/restart/terminal projection、呼吸灯与 modern route 定向层通过 | 独立 Review |
| R8 faults/observability/E2E | `TARGETED_PASS` | writer/static/source coverage、409/timeout/replay/schema/release/observability 定向层通过；`m79 3/3` | 独立 Review |
| R9 freeze/full Review/formal full | `PASS` | v0.7.9 migration delta 定向 `67/67`；独立 Review `P0/P1/P2=0/GO`；变更后 formal full `1229/1229 PASS` | 不得重复 full |
| R10 release/production/canary | `IN_PROGRESS` | v0.7.9/schema43已部署；双schema备份恢复和33静态文件通过；刷新NO_GO、真实click0 | 解决刷新合同/加载失败并补齐剩余生产门 |

## 6. 测试与副作用账本

- 正式 full 历史执行：`2` 次；首轮 `1192/1226 passed, 30 failed, 4 skipped`，第二轮 `1224/1227 passed, 3 failed, 0 skipped`，均 exit `1`；不得改写为通过。
- v0.7.8 历史冻结候选 mandatory formal full：`1/1 PASS`；`127` specs、`1227/1227`、0 failed、0 skipped、exit `0`。v0.7.9 变更后 formal full：`127` specs、`1229/1229 PASS`、0 failed、0 skipped、0 retries/blocked/reportErrors、exit `0`；不得重复。
- 真实目标 group 点击：`0/1`。
- 本 Goal 新 Provider POST：`0`。
- 本 Goal 新 OSS 写：`0`。
- v0.7.8 exact-tag release 目录已在服务器 fresh build，但未切 `current`、未停启生产服务、未迁移生产 DB；生产仍为 v0.7.7/schema42。
- 自动化必须使用本轮新建临时目录、动态 loopback 且端口不得为 `4173`；真实 Provider/OSS/生产数据不得进入自动化测试。

### 6.1 冻结前最近定向证据

- `/Users/mymy/.hermes/node/bin/node scripts/run-safe-tests.mjs run --spec m86-canvas-load-safety`：`83/83`，exit `0`。
- 同一 safe runner 运行 `m104-canvas-command-gateway + m3-persistence + m37-media-upload-transactions + m79-canvas-smoothness + m84-copy-paste`：`64/64`，exit `0`。
- `/Users/mymy/.hermes/node/bin/node scripts/run-safe-tests.mjs run --spec m105-canvas-writer-manifest`：`1/1`，exit `0`。
- 每次均证明 protected-file 隔离、credential/network guard、动态 loopback、source snapshot 不变；最近 source coverage `514/514`（TS `462/462`、JS `52/52`）。
- writer manifest check：`295` source files、`256` raw hits、`200` product hits（client `131`、server `69`）、`95` exceptions、`0` violations。
- `m86` 调试期间先最小归因再修复：恢复本地 re-entrant Canvas admission；保留 pending durable debounce；drag/resize view preview 在 foreign high-water rebase 中不丢失且不重复 command。最终完整 `m86 83/83`；临时诊断代码已移除。

### 6.2 候选冻结身份

- baseline HEAD：`a401016607f1b01b2c266caa786d61734d64b545`；branch：`codex/v0.7.8-canvas-write-boundary`；origin：`https://github.com/jasionia1991-max/unboundry.git`。
- 首次冻结时允许范围内共有 `139` 个改动/新增文件（tracked `118`、untracked `21`），分母为 `1847` 个 unified diff hunk；独立 Reviewer 已覆盖 `139/139`、`1847/1847`。
- 第四轮 finding 修复后仍为 `139` 个允许范围文件（tracked `118`、untracked `21`），当前分母 `1855` hunks；候选 payload 由除 Plan/Matrix/Checkpoint 三份协调回执外的 `136` 个改动/新增文件组成，按路径排序并依次输入 `path + NUL + file bytes + NUL` 计算的新 payload SHA-256 为 `5833e0f0dffc5054f97e0d5f21be1ae7a6e2572bc06c2270f7aecd71cd3c5a1b`。
- writer manifest 原始文件 SHA-256：`7d0d5fcd2053b4003c4fc8c4b54b24622225e50a4a5a459c29d846d2b59856df`；checker canonical fingerprint：`abd9a8d8aae6a16daf04849495f5a6ad1e846822ad8db99e33e224de58c3f7bb`；source tree hash：`8d557e790f63952ba9e862fa439914180457cacccb54302ddf1b34cd7937278d`；结论 `253` raw / `200` product / `92` exceptions / `0` violations。
- payload hash 明确排除仅用于记录门禁状态的 Plan/Matrix/Checkpoint，以便 Reviewer 回执可更新而不改变产品候选；永久保护的两个 JSON 同样完全排除且不得访问。除回执更新和 Reviewer finding 修复外，冻结后禁止并行写入。
- 2026-09-05 formal-full 闭环后的当前再冻结身份：允许范围 `153` files（tracked `132`、untracked `21`）、`1919` hunks；排除 Plan/Matrix/Checkpoint 后产品 payload `150` files，SHA-256 `0cf6e5ab45e0825ea3cafd72e2a455b1cb399136dca07236834c1b6f9e8153e7`。writer manifest 原始文件 SHA-256 `cbe4570fbae6203196fd905ec0d9f79f21ba0bf37ad7fd7d08c2b0d218840be0`、checker canonical fingerprint `9ab50c550a153bb7c962e9ed7e72dc27d62d5c90ed758c3541bc3d7ee55e941a`、source tree hash `1b0f03e814b338b7884576ea69afbc0625b00af051ffe3bbf86133dc95379aa0`，结论 `256/200/95/0`。

### 6.3 首轮独立 Review finding 处置

- 首轮覆盖：`139/139` files、`1847/1847` hunks、`250/250` writer entries、CWB `194/194`；结论 `P0=0 / P1=2 / P2=2`，因此 formal full 保持 `0/1`。
- P1：现代 topology 现已强制 parent 指向 group、group 不可作为 child、group-members 的 group kind 与已有 parent 移动前置条件 fail-closed。
- P1：legacy PUT 的普通 user document 现与 authoritative projection 在同一事务、同一最终 revision transition 合并；user document 纳入 receipt payload hash，浏览器 result patch 仍被忽略并由服务端重建。
- P2：现代 create/connect/paste 的 edge handle 必须为 `source`/`target`；legacy 文档保持独立兼容验证。
- P2：legacy terminal detach 409 OpenAPI 改为 conflict 与 rollout-disabled 两个精确 schema 的 `oneOf`。
- 修复后定向 safe run：`m104 + m20 + m85 = 42/42`、`m105 = 1/1`、`m63 + m84 = 6/6`，全部 exit `0`；formal full 未执行。
- 同一独立 Reviewer 的增量复核尚未完成；在其将四项 findings 全部归零前，R9 仍为 `IN_PROGRESS`。

### 6.4 第二轮独立 Review finding 处置

- 同一 Reviewer 已确认首轮四项 finding 全部关闭，但在增量复核中新增 `P0=0 / P1=2 / P2=1`；因此 formal full 继续保持 `0/1`。
- P1：legacy full-document PUT 现在对所有 descriptor `input=true` 的用户输入做 before/after 比较；prompt/model/parameters/content/asset 等输入变化会清除旧 generation proof。带旧 `generationProjection` 的同请求输入变化会在任何投影写入前 fail-closed，不允许旧结果与新输入共存。
- P1：无 capability 的 legacy projection 已移到 workflow lock、stale projection、same-session high-water/capacity 与 uploaded-media adoption 之后；投影、writer sequence/high-water、上传 adoption 和最终 commit 处于同一 `BEGIN IMMEDIATE` 事务。
- P2：writer scanner 现在记录 SQL 所在 control-flow 上下文；`applyGenerationProjectionCore` 的 existing-receipt legacy merge SQL 保持受控例外，共享 modern server projection SQL 精确归类为 `Durable Server`，不再错误借用 legacy 例外。
- 新增回归覆盖后，safe runner 结果：`m85-canvas-persistence-server 31/31`；`m103-server-authoritative-workflow + m104-canvas-command-gateway + m105-canvas-writer-manifest 24/24`；全部 exit `0`。测试总库存从 `1225` 精确更新为 `1226`，source coverage 仍为 `514/514`。
- 当前等待同一 Reviewer 对 `139/139` files、`1855/1855` hunks、`253/253` writer entries、上述三项增量修复和完整调用链作最终只读复核；只有其给出 `P0=0 / P1=0 / P2=0` 才允许唯一 formal full。

### 6.5 第三轮独立 Review finding 处置

- 同一 Reviewer 对第二轮修复后的冻结候选完成 `139/139` files、`1855/1855` hunks、`253/253` writer entries 与 CWB `194/194` 复核，前述三项均关闭；新增结论为 `P0=0 / P1=1 / P2=0`，formal full 继续保持 `0/1`。
- 唯一 P1 已修复：legacy node 顶层 input 字段、legacy edge input 拓扑、legacy 权威素材替换和 modern `apply-topology` 现在都在同一事务中按受影响目标节点清除旧 generation proof；旧/新 node kind 均清理，连接边只失效 target，不误清 source。
- canonical input fingerprint 已与 node 顶层 `input=true` descriptor 对齐；proof 失效后 `assetId` 重新进入 input fingerprint，确保语义变化推进 `graphRevision`，旧结果不能冒充新素材或新拓扑。
- 修复后 safe runner：`m85 + m92 + m104 = 46/46`，`m105 = 1/1`，全部 exit `0`；测试库存仍为 `1226`，writer manifest 仍为 `253/200/92/0`。
- 当前已按新 payload/hash 冻结并交同一 Reviewer 只读终审；只有 `P0=0 / P1=0 / P2=0` 才允许唯一 formal full。

### 6.6 第四轮独立 Review finding 处置

- 同一 Reviewer 确认第三轮 proof P1 已关闭，但新增 `P0=0 / P1=1 / P2=0`：capability legacy PUT 在 upload adoption 后若 projection conflict，外层会提交拒绝 receipt，却也会错误提交 adoption；modern 多素材 adoption 中途冲突也可能提交前半部分 adoption。
- 唯一 P1 已修复：legacy capability adoption 使用外层 savepoint，任何 media/projection conflict 先回滚 adoption 再持久化 rejection receipt；modern command 的多素材 adoption 同样用 savepoint 保证全有或全无。成功时 adoption、Canvas 与 receipt 仍在同一 `BEGIN IMMEDIATE` 事务提交。
- 回归已覆盖 rejected capability upload 保持 `adopted_at/adopted_canvas_id=NULL`、Canvas revision 不变；modern 两素材中第二项冲突时第一项 adoption 也回滚、Canvas 不变、冲突 receipt 可重放。
- 修复后 safe runner：`m85 + m104 = 42/42`；`m88 + m105 = 39/39`，全部 exit `0`；测试库存仍为 `1226`。
- 当前按第四轮 payload/hash 再次冻结并交同一 Reviewer 最终增量复核；其 `P0/P1/P2` 归零前 formal full 仍为 `0/1`。

### 6.7 最终独立 Review 回执

- 同一独立 Reviewer 已完成最终只读复核：`139/139` files、`1855/1855` hunks、`253/253` writer entries、CWB `194/194`；10/10 models、12/12 identities、6/6 adapters 均覆盖。
- 最终结论：`P0=0 / P1=0 / P2=0 / GO`；第四轮 adoption savepoint finding 已关闭，无新增 finding。
- 冻结产品 payload 仍为 `136` files，SHA-256 `5833e0f0dffc5054f97e0d5f21be1ae7a6e2572bc06c2270f7aecd71cd3c5a1b`；writer manifest 仍为 `253/200/92/0`。
- Reviewer 未运行测试、生产、浏览器、Provider/OSS，也未触碰永久保护 JSON。唯一 formal full 现已获准，但本回执写入时仍为 `0/1`。

## 7. 当前停止点

最后一次 mandatory formal full 已取得 `1227/1227 PASS`，同一 Reviewer 最终 `P0=0 / P1=0 / P2=0 / GO`。R9 已关闭，当前进入 R10，不再重复 full。发布、生产、普通 Chrome、真实 Provider/OSS 尚未执行。

### 7.1 Formal full 失败闭环

- 正式 full 原始失败分布：`m102(2)`、`m17(2)`、`m22(1)`、`m27(1)`、`m28(1)`、`m29(1)`、`m31(1)`、`m34(1)`、`m35(2)`、`m36(1)`、`m41(6)`、`m60(2)`、`m68(1)`、`m71(2)`、`m82(1)`、`m86(1)`、`m98(3)`；另有 `m29(2)`、`m65(2)` 共 4 条 skipped。
- 全部 30 条失败均已在受影响规格中重现、修复或证明为陈旧 fixture，并由对应完整 spec 定向通过；没有重复运行旧候选 full。
- 新增 `replace-edge` 原子合同回归使库存变为 `1227`；runner inventory 与 source coverage manifest 已同步，最新 source/type/architecture/credential/network/动态 loopback 门通过，端口 `4173` listener 保持不变。

### 7.2 当前再冻结候选独立 Review 回执

- 覆盖 `153/153` files（tracked `132` + untracked `21`）、`1919/1919` hunks、payload `150/150` 且 SHA-256 `0cf6e5ab45e0825ea3cafd72e2a455b1cb399136dca07236834c1b6f9e8153e7`；writer `256/256`、product `200/200`、exceptions `95/95`、violations `0`。
- 10/10 models、12/12 identities、6/6 adapters、CWB `194/194` 均覆盖；此前 document identity P1 与 m41 save-fence value P2 已关闭，无新增 finding。
- 最终结论 `P0=0 / P1=0 / P2=0 / GO`；Reviewer 未运行测试、formal full、生产、浏览器或 Provider/OSS，永久保护文件访问 `0`。

### 7.3 第二次 formal full 失败闭环与当前冻结身份

- 第二次 formal full 原始结果：`1227` tests，`1224 passed / 3 failed / 0 skipped`，exit `1`。
- Text 产品竞态已用 latest-body mutation fence、focused same-value DOM guard 和 committed-ref copy 关闭；m1/m69 fixture 只增加前序状态落地等待。safe runner 复验为三轮 `60/60` 加直接依赖 `76/76`，source snapshot 与 4173 listener 均保持不变。
- 当前身份：允许范围 `155` files（tracked `134`、untracked `21`）、`1931` hunks；排除 Plan/Matrix/Checkpoint 后 payload `152` files，SHA-256 `0b17dd9fe61550e4a254dec78d15286491e56110dd65c857046d50c24f485661`。
- writer manifest：`295` source、`256` raw、`200` product、`95` exceptions、`0` violations；原始 SHA-256 `3c9b0662a334f11b6f0a51e37d69cbf262cd65edf49758d231aa3ef274b1b68e`、canonical fingerprint `bbe9aa46bd84b41abbeca213d9221052122219ef75e7e9e24f4a43e403023df8`、source tree hash `8d4a5f8fce10c30c66c5b28d4eb2685197954418d9ce854e1ee2222eaf689e2d`。
- 先前 `153/153` Review GO 已被后续变更失效；当前候选冻结并等待同一 Reviewer 只读增量终审，formal full、R10 和真实费用动作继续禁止。
- 同一 Reviewer 已完成 `155/155` files、`1931/1931` hunks、payload `152/152`、writer `256/256`、CWB `194/194`、10/10 models、12/12 identities、6/6 adapters 终审；保护文件访问 `0`，结论 `P0=0 / P1=0 / P2=0 / GO`。
- 当前候选只获准执行最终 formal full；在 full PASS 前，R10、浏览器、Provider/OSS 和真实费用动作仍禁止。

### 7.4 最终 full 压力等待修正

- 最终 formal full 原始结果为 `1225 passed / 2 failed / 0 skipped`，exit `1`；m4 替换观察超出默认 5 秒，m41 双轮询持有用例超出默认 60 秒。其余 1225 条全绿，source snapshot 与 4173 listener 不变。
- 原候选不改代码的完整规格复验为 m4 `7/7`、m41 `59/59`；等待预算修正后两规格合并 `66/66 PASS`。产品行为未改，Provider/OSS/生产写仍为 0。
- 当前冻结身份：`155` files（tracked `134`、untracked `21`）、`1934` hunks；payload `152` files、SHA-256 `96b62e1e11a65451f578b2ffa925ab2a9be2fd97569614269de7adbf9e77f087`；writer manifest 仍为 `295/256/200/95/0`。
- 当前只等待同一 Reviewer 对两处测试等待预算和 identity 作只读复核；GO 后执行最后一次 mandatory formal full，必须命令本身 exit `0`。
- 同一 Reviewer 已核对正确的 m41 old-Image-poll hunk及 m4 两个 poll hunk；业务断言、task submission=1 与 Provider=0 均未弱化。`155/155` files、`1934/1934` hunks、payload/hash 无 drift，结论 `P0=0 / P1=0 / P2=0 / GO`。
- 当前唯一动作是最后一次 mandatory formal full；在命令 exit `0` 前不进入 R10。

### 7.5 Mandatory formal full PASS 与最后 delta

- 等待预算候选 full 的一次中间执行为 `1226 passed / 1 failed / 0 skipped`、exit `1`；唯一失败是 m41 terminal Text 用例的本地临时服务器 `route.fetch` 遇到一次 `ECONNRESET`。其余测试、source snapshot 与 4173 listener 正常。
- 该测试的对应 fetch 现使用 Playwright 内置 `maxRetries: 2`，只重试 `ECONNRESET`；业务断言、Canvas 零浏览器 terminal write、generation POST 与 Provider request 零值均保留。完整 m41 定向复验 `59/59 PASS`。
- 最后一次 mandatory formal full：`127` specs、`1227/1227 PASS`、0 failed、0 skipped、exit `0`；Node/npm `22.23.1/10.9.8`；source/snapshot SHA-256 `70ac7cd827e2442cfe91d4a39639328b267218864b1fff2102791cf8914ca6da`；4173 listener hash `24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244` unchanged。
- 当前冻结 identity：允许范围 `155` files（tracked `134`、untracked `21`）、`1934` hunks；排除 Plan/Matrix/Checkpoint 后 payload `152` files，SHA-256 `8e7a00c6b11b3410fed749e72cebc4856c4cdf84bf90b6c7f3d91e2045c70567`；writer manifest `295/256/200/95/0`。
- 同一 Reviewer 已对该单一 test-only delta 与最终 identity 完成只读收口：`155/155` files、`1934/1934` hunks、保护文件访问 0，`P0=0 / P1=0 / P2=0 / GO`。R9=`PASS`，进入 R10；禁止再次运行 formal full。

### 7.6 v0.7.8 生产 preflight 与 v0.7.9 再冻结

- v0.7.8 已完成 PR #157、双 CI、annotated tag、GitHub Release 与 exact-tag fresh build；该 release 保持不可变且未部署。生产 `current`、服务与数据库均未切换，仍为 v0.7.7/schema42。
- 上线前只读 census 证明 active task/run/publication/capacity 全 0，同时存在 23 条绑定 failed/cancelled 终态 task 的 Provider boundary 历史证据。v0.7.8 one-shot 错把这些永久计费/恢复证据当作活跃执行并拒绝迁移；生产 DB 未修改，Provider/OSS/费用新增均为 0。
- v0.7.9 仅修正 42→43 quiescence 判定：保留 active task/run/publication/capacity 与 generation freeze 门；terminal task 的 accepted、response-received、outcome-unknown 行逐字段保留，不 settlement、不删除、不重发 Provider，也不重新准入终态 task。
- production-shaped migration 回归覆盖 failed/cancelled task 的 accepted、response-received、outcome-unknown；dry-run 保持 source schema42 不变，apply 后 schema43 且三行全部字段相同。
- 首轮独立增量 Review 覆盖 `17/17` files、`55/55` hunks，产品逻辑 `P0=0 / P1=0`，但因 attempt 全字段/terminal 组合和 schema42 五个静默负向门缺少直接回归而给出 `P2=2 / NO_GO`。
- 两项 P2 已补测：三类 historical outcome 现在覆盖 failed/cancelled task 并对 `generation_provider_attempts` 全部字段逐项比较；active task/run/publication/capacity 与 generation-unfrozen 均验证精确错误、source bytes 不变和 schema42 不变。
- 定向 safe runner 结果：m91 `12/12`、m81+m103 `54/54`、m105 `1/1`，合计 `67/67`，全部 exit `0`；测试库存 `1229`。writer manifest 为 `295` source、`256` raw、`200` product、`95` exceptions、`0` violations，source tree hash `7f7942be29d4e342ec079439468d1136dd2fc2f2de5d4771a64cd944020330bb`。
- 补测后同一 Reviewer 确认原两项测试 P2 与后一项文档同步 P2 全部关闭；最终覆盖 `17/17` files、`55/55` hunks，`P0=0 / P1=0 / P2=0 / GO`，保护文件访问 0。当前只允许执行一次变更后 formal full；在其通过前 R10、生产、浏览器与真实 Provider/OSS 继续阻断。
- 变更后 formal full 已通过：`127` specs、`1229/1229 PASS`、0 failed、0 skipped、0 retries/blocked/reportErrors，exit `0`；Node/npm `22.23.1/10.9.8`，source/snapshot SHA-256 `3b1fcd369e292c272183e3db7ee8316a38f700b96847f83e0370d2a0ebcbb9ea`，4173 listener hash `24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244` unchanged。post-receipt m38 `19/19 PASS`，source/snapshot `f547b946a5ed7b2d3e1318f9aaff9e9e6c81fbeaddca64923bbc06dcd66137a1`、4173 unchanged；同一 Reviewer 对当前 `17/17` files、`56/56` hunks完成只读收口，保护文件访问 0，`P0/P1/P2=0/0/0 / GO`。R9=`PASS`、R10=`READY`；禁止再次运行 full。
