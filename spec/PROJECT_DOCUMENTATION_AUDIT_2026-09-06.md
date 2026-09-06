# 全仓查阅、项目现状与文档同步记录

日期：2026-09-06。状态：`DOCUMENTATION_SYNC_COMPLETE / NO_PRODUCT_CHANGE / UNCOMMITTED`。

本轮完成全仓文件盘点、类型/语法和架构扫描、前后端及运维测试入口查阅，并核对实际生产与GitHub状态；据此更新55份既有仓库Markdown、新增本报告及3份索引/快照、同步13份外层说明。**这是有逐文件覆盖记录的现状与文档核对，不是所有代码逐行、逐分支的缺陷或安全审计，也不是一次全量业务回归。**

统一现状入口：[CURRENT_STATE](UNBOUNDRY_CURRENT_STATE.md)。所有文档的处理理由见 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)，源码深度见 [查阅覆盖](PROJECT_SOURCE_REVIEW_COVERAGE_2026-09-06.tsv)，机器可读事实见 [状态快照](PROJECT_STATUS_SNAPSHOT_2026-09-06.json)。

## 1. 实际身份和边界

| 项目 | 本轮核对 |
| --- | --- |
| 实现仓库 | `/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03` |
| 分支 / 开始HEAD | `codex/video-node-preview-containment` / `038ee8444e1b0901b28b5a2a65c08eca5c9400b9`；开始工作树干净 |
| 产品commit | `c9d414a32613a28b5e013ee671223fcc219c7e05`；本地后两次提交为发布收尾文档 |
| 远端 | main及v0.7.14 peeled tag均为产品commit；本轮查询打开PR为0；没有新push/PR/CI |
| 线上 | `/opt/unboundry/current`指向`/opt/unboundry/releases/v0.7.14-media-aspect-20260906`；active/running、schema43、PID839221、NRestarts0 |
| 工具链 | 开发Node25.9.0/npm11.12.1；专用安全/覆盖Node22.23.1/npm10.9.8；生产Node22.23.2/npm10.9.8 |
| 恢复点 | `codex/restore-v0.7.11-before-performance-20260906`仍为`39c6385427d3f62d1e4f8231046bb5159ee55ecd` |

`/Users/mymy/Documents/unboundry`外层Git尚无提交，只作为材料目录；历史app/其他工作树保留，未清理、未当作当前实现。线上状态观测时间为2026-09-06 19:15:47 CST；它是时点证据，不是持续监控。

本轮没有改产品、测试、依赖、现有JSON证据、线上服务或数据；没有读取业务数据库、执行备份/恢复、付费生成或清理，没有commit/push/tag/deploy，没有激活Goal。两份永久保护JSON按路径提前排除，未读取、stat、hash、复制或修改。

## 2. 全仓覆盖的分母与深度

- **518份程序源码**：466份TypeScript与52份JavaScript均在本轮类型/语法检查范围内。
- 另查阅1份CSS、1份HTML入口、2份server模板数据JSON；逐文件清单合计**522项**。这2份server JSON不是永久保护文件。
- 前端及共享类型134项；后端168项；脚本/运维/测试216项；根配置4项。前后端由两个只读代理核对，主代理复核关键发现并负责文档、操作与验证。
- 156项记录为全文读取（前端89、后端67），146项为结构与重点段，220项为结构入口加静态验证。全文读取也不等于每个分支已证明正确；大文件没有声称逐行语义审计。逐项范围、原始SHA及未覆盖语义列在TSV。
- 187份原有仓库Markdown均建立标题/章节/当前状态路由索引；需要更新的当前文档精读纠偏，其余历史方案、矩阵、调查按时点保留。外层21份Markdown也逐项分类，13份加当前路由。不是把全部历史PASS、日期和版本批量改成今天。
- 没有对历史截图/视频/所有发布包做全量内容审计，没有重新调用真实Provider或验证每个已发布模型，也没有竞品同环境性能对比。

本轮源码覆盖是全文件静态覆盖与按记录深度查阅；不能用“518/518”替代全部调用分支的行为证据。后续若开展缺陷审计，仍需按风险和实际变更定义分支范围。

## 3. 按代码确认并修正的文档

| 原来的漂移 | 当前修正 |
| --- | --- |
| README旧版当前标题、各入口堆叠已消费授权/未发布状态 | 单一CURRENT_STATE字段，现状v0.7.14 USER_PASS；旧记录明确历史身份，不恢复旧Goal |
| 生成架构仍写统一输入/后端workflow计划中，仅image/video、尚未部署 | 重写组合根、四类能力、持久workflow/admission、Provider attempt、staging/publication及Canvas投影；模型工作流资格单独受恢复策略限制 |
| 把task、素材、节点显示简写成一起成功 | 按代码写清媒体发布与task事务、Canvas savepoint/独立projection状态、只同步原结果的恢复边界 |
| UI尺寸字段名不准确、规则易被理解为加载时自动写尺寸 | 改为`mediaSizingMode`；旧节点保留、auto/manual可信接管、主动适配/撤销、播放/刷新不写尺寸 |
| 模板优先级语义含糊 | selected触发临时CSS整体置前；插入模板仅primaryId不等于自动选中；位置/持久zIndex不变 |
| Runbook仍指旧schema/旧一键发布/直接回退旧包 | 当前schema43签名加密/冻结/恢复/云校验门；旧deploy已禁用；旧构建配对工具非通用发布器；v0.7.14须兼容回退包 |
| 自动备份timer active容易被误写为备份成功 | service failed与手动云备份成功分开；登记实查schema41旧脚本根因 |
| 版本更新说明把正常SSE等同故障重连成功 | 按UpdateNotice/EventSource实现和生产502记录保留重连OPEN；保存失败不强制刷新 |
| 历史跨标签409、无后台/未部署及4173测试规则混入当前合同 | 明确DATA-005跨标签最后保存者胜、同标签迟到旧请求拒绝；历史记录保留，废止旧4173操作指令 |
| 模块化历史计数/待集成被误当当前状态 | 同步本轮AST边/例外数；历史计划不重启，只有真实新功能触发才推进结构调整 |

AGENTS、README、TASKS、CURRENT_STATE、总验收矩阵、主题断点、架构/UI、上线规矩、Runbook、备份运维、版本更新及历史断点路由均已同步。历史冻结矩阵/回执的原始验收结果不升级，未修改既有生产JSON回执。

## 4. 当前真实未决项

| 项目 | 事实与边界 |
| --- | --- |
| 每日自动备份 OPEN | 03:30作业exit1。实际ExecStart仍调用`/opt/unboundry/scripts/backup-to-oss.mjs`，其`backup-data.mjs`硬编码schema41，生产43触发`Backup database validation failed`。本轮只读定位，未修。需单独补齐冻结、签名/加密、校验恢复和上传验证链 |
| 性能 PARTIAL | v0.7.13历史27张缩略图冷加载11.682s、首次新建画布1.214s；来源为旧发布记录，本轮未重新测量；不能宣布对齐TapNow/LibTV |
| 维护后SSE更新提示 OPEN | 已有生产502后旧流不恢复记录；客户端只有一次EventSource建立、未实现显式错误重建。正常SSE有测试不等于断线恢复通过 |
| 依赖告警 OPEN | GitHub当前2条medium，均针对锁内qs6.15.3；GHSA-x5fp-wj9c-mxmx、GHSA-4mjr-xmp4-gh2g，修复版6.16.0。来自ali-oss/urllib链；本轮未升级或证明可利用性。CI high阈值不会因此失败 |
| 其他功能 PAUSED/PARTIAL | 真实Agent、团队/多人、打光、Mureka真实生成、Storyboard完整生命周期等遵从原矩阵；代码支持不自动获得USER_PASS |

已有手动云备份1004文件/1,939,771,911字节上传及GET哈希核验成功，独立verify/fresh restore通过；98条历史媒体非阻断提示保留。**不能用一次手动成功覆盖每日自动备份失败。**

兼容回退包`v0.7.14-compat.1`已备，保留CURRENT和新字段/manual保护；直接切v0.7.13不兼容。既有证据包含隔离Linux配对HTTP与DELETE写入验证，未执行真实线上systemd回退演练。v0.7.11只是保留代码检查点，不是任意时点数据库无损降级承诺。

## 5. 本轮验证与复用证据

验证范围由文档变更和现状核对决定；不因文档修改重新运行业务全套或发布构建。

| 本轮实际执行 | 环境 / 结果 / 解释 |
| --- | --- |
| `scripts/check-source-coverage.mjs` | 专用Node22.23.1，exit0；518/518稳定，TS466、JS52；运维注册21+辅助2、冻结15，总36；属于静态/登记检查 |
| `analyzeArchitecture` API | Node25.9.0，exit0；应用298、runtime边1039/type边274、登记例外88、新增/无效/失效0、runtime SCC0；88例外不是零耦合 |
| `scripts/check-canvas-writer-manifest.mjs --check` | Node25.9.0，exit0；raw264、product203、exceptions100、violations0；未改manifest |
| 文档合同定向断言 | 按m38的current-state文档测试原断言单独执行，exit0；版本、治理标记、读取顺序、历史身份和模块化标记一致；未启动业务运行时 |
| 文件保护与差异 | 原清单639份非Markdown文件SHA不变；既有变更仅Markdown，新建仅报告/TSV/状态JSON；`git diff --check`通过；永久保护文件排除 |
| 文档链接/历史保留 | 新增与重写当前区块的仓库相对链接核对；历史路由追加项原正文逐字保留。历史失败与旧验收未擦除 |

检查过程中修正了架构工具的stdin调用方式（改用`-e`），以及一处新增文档行尾空格；均不涉及产品故障，未为此重跑业务测试。

复用v0.7.14回执的87项定向及6项未受影响测试、921源码不可变构建、33静态公网/回环一致、原视频contain与原比例/撤销/刷新验证、PR/main CI、冻结备份和对应USER_PASS。1271是该回执记录的测试库存，不是本轮运行数；当前safe manifest有128个spec（dev76/hybrid4/node36/preview2/self10），本轮未全跑。

原始本轮证据在外层 `project-documentation-audit-20260906/`，包括前后端逐文件JSON、AST图、日志、生产只读快照、告警、改动原因和验证脚本；本报告及仓库快照保留必要结论与可携带索引。独立文档复核指出TASKS历史区块仍有“当前任务”标题，已改为历史时点并明确当时授权结束；保留原记录事实，没有重启实施。其余指定当前文档未发现阻断。当前新文档未commit/push，不触发上线或新版本。
