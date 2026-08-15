# Unboundry 绿地复刻验收矩阵

基线日期：2026-07-27  
当前状态更新：2026-08-15
状态：`AUTHORITATIVE`  
状态夹具：`unboundry-state-fixtures.json`

2026-08-15 当前权威状态：生产已运行 `v0.6.0/schema39`，`REM-010/011 = PASS`，`G7（本次 v0.6.0）= PASS`，`PRODUCTION = LIVE / USER ACCEPTED`。最终技术凭证 SHA-256 `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8` 为 `TECHNICAL_CUTOVER_VERIFIED`；凭证生成时的 `userAcceptance=PENDING` 不改写，用户随后确认生成任务状态已可读取，并结合此前确认老项目大量已生成/上传素材仍在、第4项正常，形成独立生产 `USER PASS`。该确认不等于逐一验证全部历史素材或所有延后功能。

最终核验为 service active/enabled、current→`releases/v0.6.0`、公网页面/version/auth正常、schema39/integrity ok/FK0、active generation0、99 tasks/99 attempts、416 ready media（local346+OSS70）、pending0；切换期间 Provider/付费调用0。切换后用户另行授权的唯一 Doubao Seed 文字生成一次成功、无重试，生产生成开关现为开启且并发/频率已收紧。原schema37备份 `7f14c611…` 与最新整机schema39包均已离机恢复PASS。最终切换为人工受控 bounded cutover，不声明新的 formal controller PASS 或切换后 full regression PASS。REM-001～009B继续`USER_REVIEW`，未在本次补验范围内的既有 PARTIAL/PAUSED/BLOCK/NOT_STARTED 条目保持不变。

2026-08-07 三功能新增 21 条（TPL-001～007 / ZIP-001～006 / KEY-001～008）已全部经用户实页验收为 `PASS`，M11 放行门达成；其余历史统计与状态仍以各节为准，`INPUT-006`保持`PARTIAL`（Mureka真实生成暂缓）。
2026-08-07 权限管理（PERM-001～012）与公共模板（PUB-001～011）已全部经用户实页验收为 `PASS`，两功能放行门达成；生成安全「并发与频率」上限按用户要求放宽至 1000（v33）。
2026-08-09 用户实页确认 `STORAGE-004 / PERF-002～005 / DEP-004` 全部通过；六项均由 `USER_RECHECK` 改为 `PASS`，该验收收口时点矩阵无 `USER_RECHECK` 项。

2026-08-15 `INC-ECOM-002 = PRODUCTION_STATIC_REPAIR_PASS / REAL_GENERATION_PENDING`：参考图prepare/send拆锁、Provider前后五类错误、整组task创建前全图预检、模型显式选择、模板edge语义保留、公共模板发布兼容门和管理页状态已实现；Storage busy及1/5/20并行专项通过。正式bridge `45e9cefe489ffea23970517c420bf9c64a49896b`与final `e1e0e0d33809a519e8856d11135237a6a30ff912`已形成；clean final正式full `117/117 specs、954/954 PASS`。生产formal artifact manifest `692995bc9f6fc6833b314afeaea65bc5d367142aa03234299c4ab02b76aa56ff`已部署到`/opt/unboundry/releases/v0.6.0`。19条模板事务绑定后为`PASS=19 / NEEDS_MODEL=0 / INVALID=0`，99个执行节点缺模型0（published87；Text50/Image42/Video7）；「服装详情页｜面料与工艺拆解」2个Text与3个Image节点均已绑定。停机备份可恢复，schema39 integrity ok/FK0；零付费复核前后tasks106、provider attempts104、active0，公网健康与登录模板面板正常、控制台无warning/error。该项仅记静态生产修复PASS；真实图片/视频结果与用户实页结果确认继续`PENDING`，并发与OSS未改。

2026-08-15 `INC-ECOM-001 = USER_RECHECK`：重复结果 URL 解析与整组执行静默停止已修复，零费用定向 `34/34 PASS`、TypeScript/build PASS；生产已切换到不可变运维热修复 `releases/v0.6.1-hotfix-inc-ecom-001-20260815`。既有任务 `9687eb96-b4b3-44c6-bf40-7fb31a854137` 只轮询原 Provider 任务 `105388646` 后成功，Provider attempt 仍为唯一一条 execution attempt1，没有第二次提交；结果素材 `860bccb1-bb24-4683-9985-4335a5f95b81` 已绑定原节点并通过文件 checksum、schema39 integrity/FK0、active0、公网健康验证。原画布结果与节点错误提示仍须由用户实页确认后才能 `PASS`。

2026-08-13 用户在隔离实页发现 default 项目卡片错误路由与 Video 重复 Prompt 两个历史覆盖缺口；`CANVAS-019 / INPUT-005` 已在候选中修复并由安全定向17/17通过。用户随后在端口58352的同一隔离实页明确确认两项修改均通过，二者恢复为 `PASS`。页面修复后的首轮 full `930/931` 暴露 m44 协作 current-open reservation 竞态；产品协议修复后 m44+m91 targeted `15/15`，fresh full `117/117 specs、931/931 PASS`，异常计数全0，证据绑定文档同步前 429-file snapshot `db91d80b…`，4173 listener不变、suite cleaned、exit0。
历史阶段记录（最终候选前）：REM-001～REM-009B 已进入`USER_REVIEW`，REM-010当时仍为`IN_PROGRESS`；runtime/lease/drain、m92严格fixture修复、Docker/第二验证机builder/ops、页面与reservation修复及脏树单轮931/931均已完成，但当时尚不是fixed candidate或REM-011三轮。该历史证据、`1e96e26f…`与`db91d80b…`指纹继续保留，不冒充最终候选。

2026-08-13 commit `8b639ffe6c5f091c51e1914f2e2c18edf9333d90` / tree `219c4df072426cfe92f33dc4045f021064972e9c` 的 429-file、source/snapshot `652b946…`、三个 full 合计2793/2793、两包竞态合计1140/1140与旧G0～G6继续作为产品 core 历史基线。F-054 后确认该 runtime 在schema37只提供health-only standby，m95/rehearsal bridge为合成夹具，不是可发布桥梁。随后 pre-formal 双引擎实现与75/75定向门仅作为历史过程证据。

2026-08-14 formal bridge B13 `51ef51ad18ae7cb7053147ba3c1dc8577fcd771d` / tree `663228d401a03e0afaa4d644aa54347f065f3eaa` / v0.5.2 与其唯一直接子 final F13 `a9051ce896cb6dda8e1ec6d1593f1de128484378` / tree `94bd8ccd8febb61aaa07304423f9c2242f4e96ac` / v0.6.0 曾固定，B→F仅package/lock三个版本值变化。formal targeted79/79、三轮full2826/2826、两轮六spec竞态1380/1380均通过且异常0；隔离非生产Linux production-validation外层receipt SHA `8f1ea003…` PASS，完成B37→B39→F39→B39 rollback→F39 reswitch、真实60秒drain与备份恢复，成功外部出站0。F13非根234节点依赖图与REM-008历史audit0图一致但非fresh audit。该证据时点REM-010/011进入`USER_REVIEW`；G5 formal Linux supplement PASS且`formalG5Evidence=true`，G6 `USER PASS`。这些现仅作为B14/F14重铸的回归基线；2026-08-14时点状态以下方原生产预检段为准，最终状态以上方2026-08-15当前权威段为准。

2026-08-14，用户在隔离临时数据与动态 loopback 端口完成 G6 并明确最终通过：A 为 B13/schema37 登录、Text/Image 与画布读写，文字节点在固定 250×250 内自动换行；B 为真实 60 秒排空及 v37→39 migration 后，在 F13/schema39 编辑、保存、重载；C 为回切 B13/schema39 后编辑、保存、重载；final 为再次切回 F13 的最终视觉复核。rollback 后画布 API 写入缺口由 C 阶段关闭。G6 证据 SHA-256 `d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d`。F13 阶段曾手动点击一次合成禁用 Provider 的 `/test`，返回 HTTP 400；`generation_provider_attempts=0`、无付费生成、成功外部出站 0，但不得写成所有 Provider/test 请求为 0。该 USER PASS 仅覆盖隔离候选，不是原生产、真实 Provider/OSS、公网兼容或发布证明。

2026-08-14 G5 外置控制器的 Mac synthetic-test 资格验证 PASS：controller SHA-256 `c78a6a367f07b72a043baf31e8d9ac80a459b029b26c4c50be7735415950b8b4`，receipt SHA-256 `6f2f2dcefbd45e2e1860c5017158d68ccd7a3e902bed946744725e98f098946d`，requests JSONL SHA-256 `49eddde273e06f33cf5aa6269d8fb3278d01d0b3eb2953d28bc3ee411d86ab23`。同一合成 B/F 夹具按 B37→B39→F39→B39 rollback→F39 reswitch 五阶段执行，7 路 GET × 每路20次，共 `700/700` 完整且语义有效；mismatch/reset/timeout/oversize/其他传输错误均为0，观测 max `9.102ms`（仅为本机观测，不是 production SLO）。另有 valid/500语义错/partial reset/hard timeout/oversize/connection-refused 六类 loopback 状态机自测 PASS；4173 既有 listener 身份前后不变。该 receipt 明确 `formalG5Evidence=false`，只证明控制器与合成夹具资格，不是 Linux formal B13/F13、原生产或发布证据。

2026-08-14 同日，DEC-REM-007 授权的单次 formal Linux supplement 在既有第二台非生产验证机完成。executionId `61b1b5dfab2e78ec4fd8d93a2caa13af3f3e724cadb489133ff6b0e191d8e755`；approval SHA-256 `dfc267e115b2278a30c8f6b214fe30bef05abe7f0075856fc3686b5cfecccc6b`；wrapper/formal controller/helper 分别为 `74e63ac68dd6a42f89f37dd577219adff5a4b3de320108a6e3f932aa2d8a4e43` / `41d5173e399a4b9dae0161e9d357254d5f4c6d6685af8c8b3b223cef83b82adb` / `46ec2a44fa71ba84eac7ffc02a561fedbe0a5550d3a6fa257cb8404b01d000c4`。outer receipt `PASS / formalG5Evidence=true` SHA-256 `ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b`，inner candidate `380ec25897f8d642c379301a313a572eb20d31e75a1ffefcc454a89487b64ad0`，requests `15d69b90ffdd4a686fd3653f664c0ec90f933281e16757f57ce07f13e5f43a92`。B37/B39/F39/B39_ROLLBACK/F39_RESWITCH 每阶段140，共`700/700`完整且语义有效，mismatch/reset/timeout/oversize/other均0；p50/p95/p99/max `24.633/74.981/89.501/103.58ms`，deadline2000ms，`productionSlo=false`。六类loopback状态机PASS；final schema39 integrity ok/FK0/marker absent/Provider attempts0；Provider/OSS/付费workload0；private net/process/caps均0。host before=after SHA `5474649e…`，4173=0、uid996=0，旧roots/services/nginx/原生产路径不变，root sealed、cleanup0。G6 C已关闭rollback API write，因此G5 coverage为`PASS`；上述延迟不是原生产SLO。

2026-08-14 原生产只读预检后，B13禁止上线。B14 `3b48f61c…` / tree `c8b0d75c…` 与唯一直接子 F14 `eb4f99ea…` / tree `86b4e424…` 已形成，proof `517d2d24…` PASS；只追加两个完整exact hash并同步runtime/backup两门。两版m81 41/41、发现117 specs/944 tests、tsc/source coverage/build PASS；clean F14 targeted `81/81`、三轮full `2832/2832`、两轮race `1420/1420`全部PASS，异常0、snapshot `6af5b891…`与4173不变、suite cleaned、均exit0；Linux未完成。用户最新已授权 `v0.5.2` bridge 的全部剩余门：formal Linux/bwrap、OSS只读HEAD/GET、维护停服、完整备份恢复、严格rowid14修复、Node22.23.2副本补证、切换与必要回滚；当前尚未完成停服/写库/迁移/切换。

F14本地门日志SHA-256：targeted `b9d260babe051c1f89ef86256ade2d57fda19b57009ec02e6973be441b5585bf`；full1/2/3 `1f6f958d57ee855b0272ddd2576277deef6ea3e299e5ccdc597d4ca1d4559741` / `903096ed64412e184dcefecfc28c6fedda809c17a570d3fa8729a3d176560b0b` / `adecd5164828a87452bf5974a594c19da2e00e54f4aed281c113d57240b7917a`；race1/2 `3d1b64868ef60e769158b31ee4f94efbed0015d251cfdac8b48f27f8918c5a18` / `fc08356cf3bc9eb96e8b18abdd9789b96aa615361897a205240537e2ba29eb46`。

`v0.5.2` 验收边界：同一不可变双引擎产物由共享supervisor只读选schema；schema37只开放登录/会话、项目/画布等基础业务读写和既有媒体读取，高风险generation/media mutation全部fail-close，`generation_provider_attempts=0`且成功外部出站0；schema39提供完整回滚；schema38/未知拒绝，启动/健康不迁移。`v0.6.0`为独立final，必须显式迁移后在schema39完整营业并能回滚到同一`v0.5.2`。bridge与final各需独立manifest/hash、三轮/竞态/全发现零异常；当前 bridge 准备授权不等于发布、迁移或 final 授权。

本轮已关闭四项P1：exact-old child只做checksum warmup且duration留给显式migrator；bridge/final共用并反复认证稳定工具先决件；source-pair只允许0.5.2直接子0.6.0改package/lock三个版本值；m92从认证manifest启动两个产物并调用bridge产物内migrator。首轮关键七spec `74/75`的唯一失败是测试`fetch`未保留生产Host；产品安全规则未放宽，改用`node:http`并补生产头正反例/Cookie安全属性后，m92 `2/2`、最终七spec `75/75`。最终定向发现117/938，异常计数0、denied186、builder1/5/1/0，证据绑定文档同步前440-file source/snapshot `47fc53b9…`，snapshot/listener不变、cleaned/exit0。这是Mac synthetic定向门，不是full、formal双提交、Linux production或G0～G6证明。

`1e96e26f…` 是 m92 fixture 窄修复后、上一轮六文档同步前脏功能树的历史 tested source 指纹；不绑定 commit，也不冒充最新或正式候选 full。

## 1. 判定规则

| 状态 | 含义 |
|---|---|
| `NOT_STARTED` | 复刻实现尚未验收 |
| `IN_PROGRESS` | 用户已明确授权该项，正在隔离实施；通常只允许一个独立施工流。F-054 后 REM-010/011 属同一双版本收口流，可同步为该状态 |
| `PASS` | 该项适用的证据完整且已经用户确认；可见产品行为还必须有真实浏览器验收。PASS 不自动扩张到未执行的真实 Provider、OSS 或生产环境边界 |
| `USER_REVIEW` | 文档或工程基础设施候选已完成，等待用户按证据/文档复核；不要求伪造浏览器实页 |
| `USER_RECHECK` | 候选实现和自动检查已完成，仍必须等待用户实页确认 |
| `PARTIAL` | 当前范围已有真实证据，但同一条目的剩余必要条件尚未完成 |
| `BLOCK` | 用户验收失败、证据不足或必要外部能力不可用 |
| `PAUSED` | 用户明确决定暂缓，保留现有实现但不继续验收 |
| `OPEN` | Unboundry 行为尚未勘测，禁止猜测 |
| `N/A` / `NOT_APPLICABLE` | 私有版范围明确不实现 |
| `RESOLVED*` | 开放问题已按当前证据、状态或层级完成裁决，不再重复验收 |

全局阈值：

- 稳定元素包围盒误差：`≤1 CSS px`。
- 关键区域像素差异：`≤5%`，且不得以整体平均掩盖明显局部错误。
- 交互必须同时验证视觉、事件命中、状态转换和持久化。
- 自动化 PASS 不能覆盖用户真实浏览器的 FAIL。
- 2026-07-30 用户决定该项目仅供小范围自用，不实现额度、积分、订阅或费用计算；Unboundry 原始证据中的数值只作为历史参考，不再是本项目验收要求。

## 2. G0 工程边界

| ID | 优先级 | 项目 | 参考 | 验收方法 | 当前状态 |
|---|---|---|---|---|---|
| G0-01 | P0 | 旧 Lumino 复用计划废止 | 旧计划顶部 | 出现 `SUPERSEDED / 禁止执行` 和新计划路径 | PASS |
| G0-02 | P0 | 完全绿地正式计划 | 新计划 §0 | 明确禁止代码、数据、端口和部署复用 | PASS |
| G0-03 | P0 | 独立 Git 仓库 | `app/.git` | `git -C app rev-parse --show-toplevel` 只返回 `app` | PASS |
| G0-04 | P0 | 复刻约束文件 | `REPLICA_CONSTRAINTS.md` | 绿地、事实源、1px、隐私和品牌约束齐全 | PASS |
| G0-05 | P0 | 状态夹具可解析 | JSON fixture | 标准 JSON 解析成功、fixture ID 唯一 | PASS |
| G0-06 | P0 | 禁止 Lumino 污染 | 整个 `app` | 除证据 `upstream` 外，不存在 Lumino 实现路径、源码、资源、数据库和配置 | PASS |
| G0-07 | P0 | 历史 Unboundry 证据已分类 | `UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md` | Unboundry 事实、条件状态、历史计划和排除内容边界明确 | PASS |
| G0-08 | P0 | 详细绿地实施方法 | `UNBOUNDRY_DETAILED_IMPLEMENTATION_METHOD.md` | 每阶段有实现顺序、方式、检查和门禁 | PASS |
| G0-09 | P0 | 旧证据来源可追溯 | `evidenceSources` | 当前报告、Stage0、40图、像素基线具有稳定 source ID | PASS |
| G0-10 | P0 | 40图机器清单已提取 | `upstream-reference-manifest.json` | 40个文件名、视口、DPR、状态和SHA完整且唯一 | PASS |
| G0-11 | P0 | 40张真实 Unboundry PNG 已自包含 | `reference/upstream-v2.12.2-dense/` | 本地恰好40张，文件名和SHA与机器清单逐一一致 | PASS |
| G0-12 | P0 | 40图视觉复核与标注完成 | `UNBOUNDRY_REFERENCE_VISUAL_REVIEW.md`、`upstream-reference-annotations.json` | 每张图均有结论并关联 fixture，或明确标为仅视觉参考 | PASS |

## 3. 空画布与固定 UI

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| UI-001 | P0 | `shell.empty.primary` | 打开 `1135×917@2x` 空项目；根容器、黑色背景、隐藏滚动正确 | M0冻结全页截图、DOM bounds及用户空壳实页验收 | PASS |
| UI-002 | P0 | `shell.empty.primary` | 点阵基础间距 20、偏移 -11、基础半径 0.5；放大时间距与点半径同步增大且更清晰，缩小时同步减小且更弱 | SVG pattern属性、缩放自动检查及用户实页复验 | PASS |
| UI-003 | P0 | `shell.empty.primary` | 左上项目区及标题坐标误差 ≤1px | Unboundry 活体 DOM、本地自动坐标、用户实页复查 | PASS |
| UI-004 | P0 | `shell.empty.primary` | 顶部社区/分享坐标误差 ≤1px；不显示积分入口 | 本地自动坐标、用户实页复查 | PASS |
| UI-005 | P0 | `shell.empty.primary` | 左侧七个入口、外框、间距、圆角、模糊一致 | Unboundry 活体 DOM、坐标 JSON、截图 diff、用户实页复查 | PASS |
| UI-006 | P0 | `shell.empty.primary` | 中央五个快捷入口仅在无节点时出现 | 空态/有节点截图、自动检查、用户实页复查 | PASS |
| UI-007 | P0 | `shell.empty.primary` | 底栏、小地图、吸附、fit view、zoom、帮助坐标一致 | Unboundry 活体 DOM、本地坐标和截图、25项自动检查、用户实页复查 | PASS |
| UI-008 | P1 | `shell.empty.primary` | Agent 气泡位置、尺寸、收起动画和命中区一致 | Unboundry 活体 DOM、本地坐标和截图、用户实页复查 | PASS |
| UI-009 | P1 | `panel.minimap.empty` | 空小地图约 198×148，无节点 rect | 本地自动检查、SVG 快照、用户实页复查 | PASS |
| UI-010 | P0 | `shell.empty.primary` | 页面无原生滚动，画布 pane 光标和 role 正确 | DOM/样式快照及用户实页复验 | PASS |
| UI-011 | P0 | `legacy.dense-canvas.neutral` | `1280×720@2x` 下62节点/58边/5组复杂画布与固定 UI 同屏正确 | 参考01、DOM/graph及用户实页复验 | PASS |
| UI-012 | P1 | `legacy.responsive.1440x900` | `1440×900@1x` 锚点、面板、world/screen 分层一致 | 参考29、bounds及用户实页复验 | PASS |
| UI-013 | P1 | `legacy.responsive.1920x1080` | `1920×1080@1x` 锚点、面板、world/screen 分层一致 | 参考30、bounds及用户实页复验 | PASS |

## 4. 菜单、面板和覆盖层

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| SURF-001 | P0 | `menu.add-node.double-click` | 双击空白和添加按钮打开同类菜单；位置、七项、禁用态一致 | 冻结菜单事实、双入口DOM、bounds、无文字误选自动检查及用户实页复验 | PASS |
| SURF-002 | P1 | `modal.node-search.empty` | 搜索 modal 尺寸、分类、placeholder、空态一致 | Unboundry活体、冻结截图、640×440 bounds、a11y及用户实页复验 | PASS |
| SURF-003 | P1 | `modal.node-search.empty`、`interaction.node-search.populated` | 有节点时按标题、Prompt、正文搜索并定位 | 真实节点索引、分类/结果断言、拖远后定位自动检查及用户实页复验 | PASS |
| SURF-004 | P1 | `panel.assets.personal-empty` | 个人/团队、文件夹、搜索和空态布局一致 | Unboundry活体、冻结截图、面板/搜索bounds、交互断言及用户实页复验 | PASS |
| SURF-005 | P2 | `overlay.ai-characters.loaded` | 全屏覆盖层、分类、筛选、5列/60卡和加载更多 | Unboundry v2.12.8活体、响应式列数、筛选/加载断言、零Provider请求及用户实页复验 | PASS |
| SURF-006 | P1 | `panel.templates.public` | 悬浮面板、首次提示、浏览全部、Tab 和三列卡片一致 | Unboundry v2.12.8活体、冻结坐标、三状态交互、零Provider请求及用户实页复验 | PASS |
| SURF-007 | P1 | `mode.comment.armed`、`interaction.group-comment-resize-sandbox-current` | 评论按钮激活、自定义光标、下一点击出现输入框；0/200、空提交禁用、提交创建48×48 Comment、可退出 | 历史证据保留；2026-07-28用户取消私有版评论功能 | NOT_APPLICABLE |
| SURF-008 | P1 | `panel.history.final` | 媒体 Tab、计数、浏览全部和缩放/排序一致；图片、视频、音频真实素材可预览、下载并重新添加到画布 | Unboundry v2.12.8活体、冻结坐标、缩放/排序交互、历史素材操作专项及用户实页复验 | PASS |
| SURF-009 | P1 | `menu.user.free-plan` | FREE、额度和限制功能由用户取消；历史证据保留但不实现 | 2026-07-30用户范围决定 | N/A |
| SURF-010 | P1 | `menu.project` | 私有版项目菜单只保留重命名、新建项目和删除；工作空间尚未实现，TapTV和竞技场已由用户明确取消，不显示不可用占位入口；重命名继续刷新持久化 | 用户产品裁决、DOM bounds、外点/Escape关闭、项目标题直接刷新持久化及自动检查；2026-07-31用户已确认精简菜单及账号浮层关闭修复通过 | PASS |
| SURF-011 | P2 | `overlay.settings.subscription` | 订阅功能由用户取消；历史证据保留但不实现 | 2026-07-30用户范围决定 | N/A |
| SURF-012 | P2 | `modal.community` | 社区功能及右上角入口由用户取消；历史证据保留但不实现 | 2026-07-31用户范围决定 | N/A |
| SURF-013 | P1 | `popover.share` | 仅保留“移动到团队项目”入口；团队功能开发前保持禁用 | Unboundry v2.12.8活体、用户范围裁决、关闭交互及用户实页复验 | PASS |
| SURF-014 | P1 | `modal.keyboard-shortcuts` | 640×566 两列弹窗、五个分组及全部快捷键文案一致 | Unboundry v2.12.8活体、DOM bounds、入口/关闭交互及用户实页复验 | PASS |
| SURF-015 | P0 | `menu.canvas-context.blank` | 空白右键菜单位置、项目、分隔线和 disabled 状态一致 | Unboundry v2.12.8活体、DOM bounds、安全动作及用户实页复验 | PASS |
| SURF-016 | P0 | `menu.canvas-context.node`、`interaction.edge-clipboard-sandbox-current` | 节点菜单复制/粘贴/副本/删除/报告及禁用逻辑一致；同画布复制后粘贴创建偏移副本且不依赖浏览器虚拟剪贴板 | Unboundry v2.12.8活体、DOM bounds、graph diff、系统剪贴板不变及用户实页复验 | PASS |
| SURF-017 | P1 | `shell.empty.primary` | 任一 modal/panel 打开后 Escape、外点、focus return 行为正确 | 键盘、外点、焦点DOM及用户实页复验 | PASS |

## 5. 画布基础交互

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| CANVAS-001 | P0 | `interaction.selection-and-keyboard-move` | 单击选择，Shift+点击多选，选中 z-index=1000；选中外观为 `#7a7a7a` 2px圆角描边，不出现蓝边或可见方形缩放角点；未选中且未悬浮时两侧连接点不可见，鼠标悬浮即显示，选中后移开鼠标仍常态显示 | 用户实页复查、DOM class、computed style、opacity | PASS |
| CANVAS-002 | P0 | `interaction.selection-and-keyboard-move` | 方向键移动 5px，Shift+方向键移动 20px | 自动前后坐标 JSON | PASS |
| CANVAS-003 | P0 | `interaction.pointer-drag-at-1.3` | zoom=1.3 真鼠标拖拽；屏幕位移/1.3=逻辑位移 | 自动指针操作、坐标 | PASS |
| CANVAS-004 | P0 | `interaction.resize-bottom-right` | 八向缩放操作区域存在但视觉透明；右下 resize 可独立改宽高且位置不变 | 自动指针操作、computed style、前后尺寸 | PASS |
| CANVAS-005 | P0 | `interaction.snap-to-grid` | 激活吸附后坐标落 20px 网格，点阵仍显示；放大时点阵更清晰、缩小时更弱 | 用户实页复查、DOM 属性、前后坐标 | PASS |
| CANVAS-006 | P0 | `interaction.manual-connect-image-to-video` | 从起点节点的连接点拖出，松到目标节点身体任意位置即可连接，不要求对准目标连接点；可与 Text 输入并存 | 用户实页复查、edge JSON | PASS |
| CANVAS-007 | P0 | `workflow.text-to-video.created` | 空态点击“文字生视频”后快捷入口隐藏，生成250×250 Text、444×250 Video及Text→Video三次贝塞尔连线；Text预填英文电影镜头Prompt；连线无箭头并有2秒循环白色高光 | 截图、自动graph/尺寸/computed style、用户实页复查 | PASS |
| CANVAS-008 | P0 | `interaction.delete-cascade-and-undo`、`interaction.group-comment-resize-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | 节点可用 Backspace 无确认删除并级联；连线被点击或鼠标停留约 0.7 秒后，中央出现 32×32剪刀按钮；仅悬浮触发时移出连线/剪刀区域即消失，点击触发时保持；点击剪刀只删连线且保留两端节点 | 连线部分和节点级联均获用户实页确认、自动graph diff | PASS |
| CANVAS-009 | P0 | `interaction.delete-cascade-and-undo` | Cmd+Z 恢复副本，新 node ID、同 asset 引用 | 自动graph/asset JSON、用户实页复查 | PASS |
| CANVAS-010 | P1 | `interaction.selection-and-keyboard-move` | 框选、反选、点击空白清选和工具栏显隐正确；多选整体框为半透明灰底、灰色1px实线、16px圆角且无蓝色阴影；多选只显示一条公共工具栏，单节点工具栏、Creator、标题输入、播放器和resize chrome全部收起；画布`Cmd+A`不产生原生文字选区，输入控件内`Cmd+A`仍只选文字 | 2026-08-04用户实页复查、`m63-multiselect-group-ui`3/3、相关回归45/45、computed style与选择快照 | PASS |
| CANVAS-011 | P0 | — | zoom 范围 0.15–2；左键拖空白框选，普通触控板双指横向/纵向滑动按1.2系数平移且zoom不变，捏合缩放；搜索定位只消费一次，光标在节点、输入框或Creator上仍可缩放；纯viewport保存不阻塞生成、不显示保存提示且面板不闪烁 | 2026-08-04用户实页复查、Unboundry活体对照、`m62-canvas-zoom-persistence`5/5、viewport/graph版本快照 | PASS |
| CANVAS-012 | P1 | `interaction.fit-five-nodes` | 5 节点 fit view 得到全节点可见和近似参考矩阵 | 自动前后可见性、viewport | PASS |
| CANVAS-013 | P1 | `interaction.selection-and-keyboard-move` | 有节点小地图 rect、selected、mask 和导航一致；198×148内容区外侧1px边线连续无断口；小地图原生按真实比例拖动且zoom不变，单击跳转到点击位置，滚轮不缩放画布 | 用户实页复查、Unboundry活体对照、自动 SVG DOM、比例拖动、点击跳转与滚轮 viewport | PASS |
| CANVAS-014 | P0 | `interaction.source-aware-connect-menus-current` | Image/Video/Audio 连线松到空白打开各自的5项/4项/2项来源菜单；外框宽288、内边距4、标题区40、内容宽278、行高52、间距4、图标框36；拖动来源节点时临时线保持连接；点击空白或其他节点后临时线、菜单和临时节点均清理，原3节点/0正式连线不变 | 活体DOM、自动菜单尺寸、拖动跟随、点击其他节点关闭、graph、用户实页复查 | PASS |
| CANVAS-015 | P0 | `legacy.interaction.invalid-same-side-edge`、`interaction.edge-clipboard-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | self、source→source、重复和二节点环不生成第二条稳定 edge；临时预览可关闭；失败端点拖拽保持原edge；当前普通edge无显式updater；无冲突的B→C仍可新增 | 参考36、自动指针、graph diff、用户实页复查 | PASS |
| CANVAS-016 | P1 | `legacy.dense-canvas.neutral` | 62节点/58边/5组拖拽、zoom、面板交互无持续掉帧或全量保存；小地图触摸板横滑不得触发浏览器返回 | DOM/graph、长任务监测、请求统计、横滑回归检查、用户实页复查 | PASS |
| CANVAS-017 | P0 | `interaction.multi-source-connect-to-node` | 多选时隐藏各节点左右加号，只在整体选择框右侧中线外12px显示一个20×20共用加号；拖动时每个已选节点各出现一条预览线，松到额外目标节点身体任意位置后，每个已选节点各生成一条到目标的稳定连线；多选保持；框选已连线节点不得显示连线剪刀，只有直接点击连线或悬浮约0.7秒才显示 | 用户截图、Unboundry活体DOM/指针、本地自动graph diff、两轮用户实页复查 | PASS |
| CANVAS-018 | P0 | — | 无限画布缩放只缩放画布内容；项目标题、左右dock、底部功能栏、Agent/分享/帮助按钮等应用UI不得随画布缩放；捏合/Ctrl+滚轮不得触发浏览器整页缩放 | 应用根部捕获拦截浏览器整页缩放手势、画布`touch-action:none`、0.15~2倍四周UI坐标实测不变、m1/m62专项7/7及2026-08-05用户4173实页确认 | PASS |

## 6. 节点视觉与编辑

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| NODE-001 | P0 | `node.text.empty`、`interaction.resize-large-text-playlist-sandbox-current` | Text 默认250×250、标题、左右端口、阅读态一致；宽高可独立扩大，至少到2671×3530不clamp | Unboundry 活体 DOM、本地 bounds、自动检查、用户实页复查 | PASS |
| NODE-002 | P0 | `node.text.selected-editing` | 双击正文进入编辑；按双击坐标放置光标；第一次 Escape 退出编辑但保留选中，点击空白清选；普通状态可拖动而编辑状态正文不带动节点 | Unboundry 活体键盘/DOM、本地自动检查、用户实页复查 | PASS |
| NODE-003 | P0 | `node.text.selected-editing` | 标题编辑、中文 IME、保存中/已保存反馈正确 | 中英文及混合输入、Cmd+Z、保存状态专项自动检查、用户实页复验 | PASS |
| NODE-004 | P1 | `node.text.selected-editing` | 48px 格式栏及 H1/H2/H3/正文/粗斜体/列表/分隔线可用 | Unboundry 活体 DOM、本地编辑结果、自动检查、用户实页复查 | PASS |
| NODE-005 | P0 | `node.image.empty`、`interaction.upload-media-sandbox-current` | Image 空态250×250；横图以高250、竖图以宽250保持原始比例，16:9为444×250、9:16为250×444；上传态隐藏左侧加号、保留右侧加号；两态均无resize control；上传态可拖动、悬浮显示替换、标题支持中英文编辑；上传/替换/改名/移动可Cmd+Z | 横竖图上传、替换、端口、拖动、比例、撤回及中文标题均获用户实页确认 | PASS |
| NODE-006 | P0 | `node.image.prompt-ready` | 678×80 Prompt、Nano Banana 2 Lite、`自适应 · 1K`、`1×`、成本5及空Prompt时Generate禁用逻辑一致；取消选中自动收起且空Image主体可拖动 | 冻结状态、表单与交互自动检查、用户实页复查 | PASS |
| NODE-007 | P0 | `node.video.empty`、`node.video.success`、`interaction.upload-media-sandbox-current` | Video空态444×250；上传后保持原始比例，横向高250、竖向宽250且576×1024为250×444；隐藏左侧加号、保留右侧加号；无resize control；节点内无中央大播放图标，选中/悬浮显示静音、播放、0.1秒进度、时长和放大；详情含播放器、音量、252×180提示词、八项信息、应用到画布及下载；支持上传、替换、拖动、标题和Cmd+Z | 2026-07-28真实Unboundry活体DOM/坐标/播放状态、自动检查、用户实页复查 | PASS |
| NODE-008 | P0 | `node.audio.empty`、`node.audio.success`、`interaction.upload-media-sandbox-current` | Audio空态/上传态均444×250且无resize control；上传后隐藏左侧加号；波形由真实音频采样生成，播放位置逐帧更新；替换仅悬浮显示，下载位于选中态上方48px工具栏；支持±10秒、播放/暂停、拖动、中英文标题及Cmd+Z | 2026-07-28真实Unboundry活体DOM/尺寸/工具栏、真实WAV解码与播放自动检查、用户实页复查 | PASS |
| NODE-009 | P0 | `node.playlist.empty`、`node.playlist.workflow`、`interaction.resize-large-text-playlist-sandbox-current` | Playlist 默认960×104、时间尺、空态一致；所有状态隐藏左右连接加号；仅有片段且选中时左侧显示两个50×50切割/导出按钮，左偏58px、间隔8px；宽高可独立扩大，至少到2057×3785不clamp；片段选择、删除、裁剪、排序、双播放头、缩放预览与导出行为一致 | Unboundry活体DOM、用户截图、本地bounds、真实媒体自动检查、用户实页复查 | PASS |
| NODE-010 | P0 | `node.group.selected`、`interaction.group-comment-resize-sandbox-current`、`interaction.group-text-playlist-large-sandbox-current` | 外接矩形建组、默认标题、圆角、8个resize control；Image+Video样本缩至312×147；Text+Playlist按四周20px包围盒建组并可扩至5047×4024且不缩放子节点；公共多选工具栏只在全部已选项可打组时启用；建组、撤销建组、刷新、删除Group、撤销删除及再刷新保持父子关系、edge和唯一性 | Unboundry活体DOM、graph diff、`m63-multiselect-group-ui`、用户实页复查 | PASS |
| NODE-011 | P0 | 全部节点 | 当前范围内七类节点为独立产品实现，无巨型 GenericNode 条件树；Comment已由用户移出范围 | 七类组件注册与实现边界代码审查 | PASS |
| NODE-012 | P1 | 全部节点 | 标题、端口、工具栏、resize chrome 的 hover/focus/selected 状态一致；Image工具栏400×48/9按钮、Video工具栏442×48/10按钮已通过用户复查，高级按钮功能不在视觉候选中伪报完成 | 2026-07-28活体DOM尺寸、状态截图集、自动bounds、各节点用户实页复查 | PASS |
| NODE-013 | P1 | `legacy.node-geometry.families` | 节点首次按内部素材比例自动适配；自动尺寸、比例派生和之后的用户八向resize互不混淆，手动尺寸刷新后保留 | 尺寸族fixture、节点几何与刷新专项自动检查、2026-08-01用户实页复验 | PASS |
| NODE-014 | P1 | `legacy.node.storyboard-table`、`interaction.storyboard-entry-template-sandbox-current` | 能载入并渲染历史1200×1000、两完成一卡加载、字段和双视图；当前菜单和“分镜大师”均无独立节点，不得臆造创建入口 | 参考13、数据快照、当前菜单DOM、本地专项检查及用户实页复查 | PASS |
| NODE-015 | P1 | `legacy.node.comment`、`interaction.group-comment-resize-sandbox-current` | 48×48锚点、300×73气泡、200字限制、空提交禁用且当前态无resize control | 历史证据保留；2026-07-28用户取消私有版评论功能 | NOT_APPLICABLE |
| NODE-016 | P0 | `legacy.node.group-dense-selected` | 3443×2111 Group、390×48工具条、24×24角控件及布局/颜色动作一致；整组执行和创建模板留待对应业务阶段 | 参考34、Unboundry当前活体DOM、本地bounds、graph diff与用户实页复验 | PASS |

## 7. 上传、媒体与生成

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| MEDIA-001 | P0 | `interaction.upload-image` | 系统文件选择器上传 PNG，传输态后自动生成 Image 节点 | 自有媒体文件落盘、节点/刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-002 | P0 | `interaction.upload-image` | 标题去扩展名、尺寸 250×250、有替换、不会进生成历史 | 标题、尺寸、替换、独立媒体身份、历史0新增、刷新及用户实页复验通过 | PASS |
| MEDIA-003 | P0 | — | 非法 MIME、超限、解码失败安全拒绝且无残留 | MIME、20MB、PNG结构/CRC、像素/解压上限及失败后文件404自动检查通过 | PASS |
| MEDIA-004 | P0 | `node.audio.success`、`interaction.upload-media-sandbox-current` | 上传WAV/MP3/M4A/AAC后显示正确时长；播放/暂停、前后10秒、进度、刷新恢复正确 | 自有服务器落盘、分段播放、真实波形、控制、WAV/MP3/M4A刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-005 | P0 | `node.video.success`、`interaction.upload-media-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | 上传MP4后320×180/1s、muted、自绘播放到ended；下载按钮tooltip、enabled态和最终文件正确，刷新恢复 | 自有服务器落盘、分段播放、元数据、进度、逐字节下载、标题即时刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-006 | P0 | `interaction.upload-media-sandbox-current` | 本地PNG/MP4/WAV经真实文件选择器上传成功；完成态无临时节点、敏感数据或残留传输 | PNG、MP4、WAV/MP3/M4A分别通过真实素材用户复验及node/media/残留自动断言 | PASS |
| GEN-001 | P0 | `node.image.generating` | 图片生成中控件禁用、18×18 点阵、blur/scale/easing 一致 | 冻结状态、样式、零Provider请求及用户实页复验 | PASS |
| GEN-002 | P0 | `node.image.success` | 图片成功保持 250×250、contain、收藏、Prompt/参数保留 | 冻结状态、零Provider请求及用户实页复验 | PASS |
| GEN-003 | P0 | `node.video.generating` | 视频生成中所有指定控件禁用，并按用户决定使用点阵呼吸动效 | 用户实页复验、DOM及零Provider请求 | PASS |
| GEN-004 | P0 | `node.video.success` | 成功视频、历史+1，不显示或计算额度；Seedance 2.0 Mini真实16:9/480p/5秒视频进入私有OSS并可播放、下载、历史预览和重启恢复 | 冻结成功态、独立历史记录；真实任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`、方舟任务`cgt-20260801165221-6fsd7`、结果SHA-256及2026-08-01用户实页复验 | PASS |
| GEN-005 | P0 | `node.audio.success` | 一次展示2个结果、历史+2，不显示或计算额度 | 本地双结果、独立历史记录、零Provider请求及用户实页复验 | PASS |
| GEN-006 | P0 | — | queued/running/success/failed/cancelled/retrying/recovering全状态均使用真实任务验证；取消不发布结果，超时保留原任务，同一任务重试只增加attempt，服务重启不自动重提；退款因额度/积分已取消而不适用 | 真实取消任务`6a9fbe16-d234-4a0e-badf-d19f2b54ffae`、超时后重试成功任务`327c2051-c2d4-4c96-9c41-f30525cd9556`、重启恢复失败任务`6a1ecfa4-a9f8-4c04-adc1-d6548982cbf8`、状态事件审计及2026-08-01用户实页确认 | PASS |
| GEN-007 | P0 | — | 幂等提交和服务重启不重复任务、不重复历史；内部持久任务表、请求指纹、状态事件审计、真实Provider提交、结果素材发布和画布引用已接通；真实图片与真实视频结果均通过停止、重启、刷新、历史和下载复验 | 图片任务`438b50dd-cd9c-42ed-8321-1fcbd49adf35`和视频任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`均保持唯一任务/历史/媒体和画布引用；视频重启后数据库仍为7条任务且只有1条视频任务，2026-08-01用户实页确认 | PASS |
| GEN-008 | P0 | `node.text.creator-open` | 选中文字节点后显示参考素材、提示词、模型、数量和提交区；失焦关闭；真实能力接入前所有动作按钮保持禁用且不得调用付费 Provider | 参考38–39、控件状态、网络检查及用户实页复验 | PASS |
| GEN-009 | P0 | `node.image.reference-ready` | 图片节点通过连线成为目标图片生成节点的参考素材；目标输入区显示参考图缩略片，删除缩略片同时删除对应连线，撤销同时恢复连线与缩略片；提交只保存归属当前账号且状态ready的素材ID，执行时才生成短时私有OSS地址或校验后的本机PNG数据，不持久化短时地址；模型不支持或超过上限时必须拒绝且不得调用Provider | 2026-07-31 Unboundry单张图片活体补测、OpenRouter官方`input_references`规则、构建、图片节点9项及Provider/任务/上传/模型13项零付费自动检查；2026-08-01用户实页确认通过 | PASS |
| GEN-010 | P0 | 图片生成恢复轮询 | 页面在图片任务仍运行时重载/重挂载后，节点必须自动继续轮询并在服务端成功后即时显示结果，无需再手动刷新；文字/音频/视频已有同等恢复行为 | m41 新增回归用例（运行中重载→自动出图）15/15、m2 图片节点全过、tsc/构建通过；2026-08-08 修复 ImageNode 恢复分支只置“生成中”不恢复轮询的缺陷；2026-08-09 用户实页确认通过 | PASS |

### 7.1 节点入参与引用优化

| ID | 优先级 | 项目 | 验收动作与断言 | 当前证据/缺口 | 实现状态 |
|---|---|---|---|---|---|
| INPUT-001 | P0 | 类型化连线矩阵 | 本项目允许11种组合：Text目标接收四类，Image接收Text/Image，Video接收四类，Audio只接收Text；其余5种不落edge并打开来源感知菜单 | Unboundry两轮实测为9允许/7拒绝；本地11/5矩阵、自连/重复/反向保护和来源感知菜单已有候选；2026-08-05用户实页确认11允许落线、5禁止不落线并打开来源感知菜单、自连/重复/反向环/源到源无效（隔离4189 fixture、零付费） | PASS |
| INPUT-002 | P0 | 统一输入解析与UI状态 | 从edge解析来源及`empty/uploading/ready/invalid/missing`；统一引用卡、角色、顺序、阻塞原因、删除/撤销和刷新恢复 | 四节点已共用edge解析器、引用卡和阻塞状态；2026-08-05用户实页确认就绪/上传中断/来源缺失/校验失败状态卡与原因、edge保留、删卡/撤销/刷新持久化（隔离4188），结合INPUT-007刷新与服务重启证据收口 | PASS |
| INPUT-003 | P0 | Image的Text+Image闭环 | 上游Text作为提示词母版，上游Image作为参考图；自身Prompt为空可用母版，两者都有时显示最终合并Prompt；服务端保存不可变输入快照 | Text+Image、最终Prompt预览、assetId输入快照及前后端预检已有候选；2026-08-05用户实页确认空Prompt使用母版、补充后显示合并最终Prompt、删卡/撤销/刷新保持（隔离4189 fixture、零付费） | PASS |
| INPUT-004 | P0 | Text四类上游 | Text、Image、Video、Audio均可作为理解输入；自身指令默认必填，模型可配置上游Text替代；不支持媒体时保留edge并显示模型不兼容 | Text已接共享解析、四类引用卡、任务快照和真实任务入口；2026-08-05用户实页确认紧凑四类引用卡、详情浮层唯一、+N溢出及不可生成提示收起（零费用）；真实任务`09ec3592-69d7-4dab-8f41-cf7d7c97f784`用Gemini 3.5 Flash Lite连Image/Video/Audio三上游成功生成并返回结果，任务快照三入参完整；用户宣布验收通过 | PASS |
| INPUT-005 | P0 | Video全能参考 | Text、Image、Video、Audio卡片及首帧/尾帧/主体/普通参考角色；已就绪上游Text或Video本节点Prompt任一即可提供最终Prompt，两者都有按顺序合并、两者都无仍阻止；Seedance当前规则最多9图/3视频/3音频；提交前完成参数、费用和Provider能力预检 | 2026-08-05 四类卡片、角色、持久化及9图/3视频/3音频真实生成 PASS 证据继续保留。2026-08-13 用户发现旧规则虽已解析 `Text → Video`，仍误强制重复填写本节点Prompt；共享前后端解析器已修正，m30 同一既有测试覆盖 `Text + Image → Video` 空本节点Prompt通过、无任何文字仍阻止及服务端零任务/零付费请求，定向17/17通过；用户随后在当前隔离实页确认提示消失与连线语义正确 | PASS |
| INPUT-006 | P1 | Audio文字合并 | 只接受Text上游；区分上游母版、自身Prompt和歌词，展示最终合并结果；重试不得重复任务 | Audio已接上游Text解析和合并候选；2026-08-05用户实页确认母版/自身Prompt/歌词区分显示、合并正确、角色切换与刷新持久化（隔离4186、零费用）；Mureka真实生成仍由`AUDIO-REAL-001`暂缓 | PARTIAL |
| INPUT-007 | P0 | 新模型、预检和持久化 | 管理员配置输入类型、数量、角色、组合、必填条件和Provider适配；不兼容切换不静默删引用；刷新/重启/复制/删除/重试不重复 | 管理页、共享角色/组合/Prompt策略、服务端重解析和输入快照已有候选；2026-08-05用户实页确认模型切换保留不兼容edge、首尾帧角色策略、9图/3视频/3音频超限提示、删除/撤销、刷新与服务重启持久化（隔离4187），复制目标唯一且不复制引用、上传中断/来源缺失/校验失败状态保留edge并显示原因、刷新持久化（隔离4188）；全程零费用、任务0、媒体1、副本唯一；重试/历史去重/余额保护由既有`OPEN-007/DATA-004/SAFETY-001`覆盖 | PASS |

## 8. 持久化、历史和权限

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| DATA-001 | P0 | `persistence.nodes-assets-viewport` | 节点、edge、媒体引用、音频时长、viewport 刷新后恢复 | SQLite文档、刷新与接口自动检查、用户实页复验 | PASS |
| DATA-002 | P0 | `persistence.final-clean-canvas` | 清空后刷新仍 0 节点/0边、占位恢复 | SQLite文档、无首屏闪回刷新检查、用户实页复验 | PASS |
| DATA-003 | P0 | `panel.history.final` | 删除画布节点不删除账号级历史 | 独立SQLite历史表、删除/刷新自动检查、用户实页复验 | PASS |
| DATA-004 | P0 | — | 服务重启后项目、任务和媒体可恢复 | 画布、视野、媒体引用、历史及运行中任务通过真实进程重启；真实图片与Seedance视频结果均保持唯一任务/历史/媒体和私有OSS引用，刷新、预览、播放及下载由用户于2026-08-01实页确认 | PASS |
| DATA-005 | P0 | `persistence.revision-conflict` | 同一画布多标签以最后保存者为准，其他标签自动同步最新内容；同一标签乱序旧保存不得覆盖新快照 | 2026-08-05用户按Unboundry实测确认“最后修改者胜”：不同标签保存始终接受并按最后写入生效、本地广播自动同步、同标签乱序旧保存仍拒绝；自动测试m3双标签收敛与m27跨标签最后写入通过；2026-08-06用户在4173双标签实页复验通过 | PASS |
| AUTH-001 | P0 | — | 未登录无法访问项目、媒体或任务；普通用户只能访问自己的数据，管理员管理普通账号和后台配置；公开注册关闭 | 专项1项及全量95项自动检查通过；用户已亲自完成首管理员初始化、普通账号创建与登录，确认普通用户无管理入口、管理员直达地址被拦截、历史为0且停用后无法再次登录；21画布、10历史、3标题和273媒体已归首管理员 | PASS |
| AUTH-002 | P0 | — | owner 可邀请/撤销，member 不可管理成员；团队项目和成员系统均按用户决定后期再做 | 用户决定后期再做 | PAUSED |
| AUTH-003 | P0 | `tests/m9-provider-secret-safety.spec.ts` | Provider 密钥不进入浏览器源码/产物、请求头、外部网络、仓库敏感文件或错误响应；当前零Provider接入 | 源码与生产包扫描、浏览器网络、4类错误响应及敏感文件检查 | PASS |
| OPS-001 | P0 | — | 当前未部署服务只监听`127.0.0.1:4173`，本机可访问而局域网地址不可访问；不得把本地验证表述为公网部署 | 进程参数、监听socket、本机与局域网地址对照探测及2026-08-01用户确认 | PASS |
| OPS-002 | P0 | — | SQLite+媒体备份可恢复到新目录并正常登录播放 | schema39自动备份已上传OSS；整机离机包包含运行目录、Node、systemd/nginx及最终数据备份，874,823,680字节/SHA `d3b6023f…ae109`，fresh restore核验schema39/integrity/FK0、99 tasks/99 attempts、416 media及运行制品/配置哈希PASS，receipt `151c7886…f3962` | PASS |
| STORAGE-001 | P0 | — | 管理员专属存储状态、普通用户隐藏；本机素材保持可读并记录对象键、类型和SHA-256；未配置OSS时云请求必须关闭且密钥不进入浏览器或数据库 | 存储/权限/上传专项16项、全量99项自动检查、273个本机素材校验值、schema 7可恢复备份及用户实页复验 | PASS |
| STORAGE-002 | P0 | `/admin/storage` | 阿里云私有Bucket、最小权限RAM身份、随机对象键、私有上传、V4短时读取签名、失败清理及云端Range/下载完整；路由默认关闭且只作用于新素材，旧本机素材不自动迁移 | 新RAM身份真实连接、短时读取和清理成功；新图片私有上传后数据库记录为OSS/ready且本机273个旧文件未变化，真实根画布刷新后仍保留图片节点，真实Range与完整下载SHA-256一致；构建、全量103项及生产隔离通过；2026-07-31用户在内置浏览器确认新图片显示、刷新保留和下载通过 | PASS |
| STORAGE-003 | P0 | `/admin/storage` | 管理员可在网页新增/替换OSS配置；AK/SK密码输入且不回显，服务端专用文件加密保存，普通账号、浏览器、SQLite、接口及审计均不得获得完整密钥；保存不访问云端，测试连接和选为正式配置必须分开授权 | 项目构建、相关专项7项、全量100项、重启恢复及正式构建隔离检查通过；管理员页面独立滚动及画布隔离28项检查通过；用户实页确认配置保存和页面滚动正常 | PASS |
| STORAGE-004 | P0 | `/admin/storage` | 读取永远按素材自身存储后端：云路由开关只影响新素材写哪里；正式配置被重复「测试连接」不得降级导致旧OSS素材失读；素材登记所属OSS配置；状态接口如实暴露原始/生效开关并告警 | m80 专项 4/4 + m10/m13/m31/m72 回归 30 通过 1 跳过；真实配置已修复（TapFK 恢复 active、routing=false）并回填 70 行；tsc/构建通过；2026-08-09 用户实页确认旧 OSS 素材恢复显示 | PASS |
| SAFETY-001 | P0 | `/admin/generation-safety` | 管理员独占真实生成总开关、紧急停止、用户/类型并发、每分钟频率、连续失败冷却和运行中任务策略；普通用户不显示额度或费用UI | schema 8持久设置、管理员权限与审计、规则直接检查及管理页专项；Provider未连接且付费请求为0；2026-08-08 起不再包含任何金额预算/上限 | 已移除（金额限制部分） |
| SAFETY-002 | P0 | 服务端 admission | 费用统计按账号隔离并支持账号独立限额 | 2026-08-08 用户决定取消全部金额限制；v36 删除账号限额表与相关逻辑 | 已移除 |
| SAFETY-003 | P1 | 「我的连接」页内区块 | 账号独立消耗上限设置与已用展示 | 2026-08-08 随金额限制功能整体移除；m81 专项删除，登录用例迁至 m11 | 已移除 |
| SAFETY-004 | P0 | 全项目 | 不再存在任何生成金额限制/上限：无全局/账号/模型级预算、无费用未知拦截、无“额度已用完”文案；任务成本仍记录（仅审计参考）；付费模型安全校验（Base64/时长/参考素材）不因移除成本而失效 | m14 3/3（含无成本字段断言）、m11 5/5、m20 19 路径、m27 20/20、m22/m38/m44/m49/m52/m55/m56/m60/m65/m10 全过、m74 仅剩已知基线失败、v36 真实库副本迁移演练通过；2026-08-09 用户实页确认通过 | PASS |
| CANVAS-019 | P1 | `/canvas/projects` | 工作空间固定显示“默认画布”卡片（不可删除、不可选择），点击后进入规范 `/canvas`，默认画布里的节点与素材始终有入口，不得经 `/canvas/default` 回跳工作空间 | 2026-08-09 默认卡片可见性实页 PASS 证据继续保留；2026-08-13 用户发现点击虚拟 default 卡片会经不存在的项目路由回跳。当前候选统一 default 卡片/返回入口到 `/canvas`，m11 新增绿地正向点击并等待持久化就绪，m11+m30 定向17/17通过；用户随后在当前隔离实页确认默认画布可正常进入且不再回跳 | PASS |
| AUTH-004 | P0 | 登录页 | 登录（含首次创建管理员）成功后直接进入工作空间，不再停在登录前的画布 URL | m81 登录落地用例、登录后 `window.location` 强制 `/canvas/projects`；2026-08-09 用户实页确认通过 | PASS |
| AUTH-005 | P0 | 账号管理 | 管理员可创建第二个及更多管理员账号（角色可选），创建写审计；普通管理员之间可互相停用/删除/改角色/重置密码 | m11 7/7（多管理员创建与互管）、m78 7/7、OpenAPI 同步；2026-08-09 用户实页确认通过 | PASS |
| AUTH-006 | P0 | 账号管理 | 第一个创建的管理员自动成为受保护最高权限账号（mymy/麦哥）；其他管理员永远不能停用/删除/降级/重置密码/改权限它；root 自己也不能在网页上改自己角色/删除自己；账号管理页显示“最高权限”徽标并禁用操作 | v37 迁移（最早管理员置 protected）、m11 受保护矩阵、真实库副本演练确认麦哥被标记；2026-08-09 用户实页确认通过 | PASS |
| AUTH-007 | P0 | 个人菜单/账号管理 | 自己改密码（需旧密码，吊销其他会话）；管理员可重置普通/其他管理员密码（受保护 root 除外，吊销全部会话）；root 忘密码时用服务器应急脚本重置 | m11 密码重置与会话吊销用例、`scripts/reset-account-password.mjs`；2026-08-09 用户实页确认通过 | PASS |

## 9. 播放列表、Agent 与外围面板

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| PLAY-001 | P0 | `node.playlist.empty`、`node.playlist.workflow`、`node.playlist.pick-ready` | 点击加号进入选片，来源节点不可拖，顶部提示、连续添加、反馈和 ESC/退出一致 | 真实Unboundry活体DOM、本地真实媒体自动检查及用户实页复验 | PASS |
| PLAY-002 | P0 | `node.playlist.workflow`、`node.playlist.clips-ready` | 9:16与16:9真实视频添加后节点仍可移动；片段拖动即时让位、总时长和自适应预览正确；片段结束后连续播放下一片 | 两个真实带声MP4自动检查、时间轴DOM及用户实页复验 | PASS |
| PLAY-003 | P0 | `node.playlist.workflow`、`node.playlist.clips-ready` | 鼠标逐帧预览、点击提交播放头、空格播放；节点内缩放时间轴、节点外缩放画布；双侧裁剪柄及 `C/Q/E`、Cmd+Z正确 | 真实Unboundry内置浏览器实测、片段起止数据、逐帧缩略图、自动检查及用户实页复验 | PASS |
| PLAY-004 | P0 | `node.playlist.workflow` | 三项导出菜单一致且均有可见结果；FFmpeg按顺序和裁剪点输出真实MP4，导出到画布在当前视野生成Video；请求中断终止进程并清理临时文件 | 三类下载/节点自动检查、真实MP4+ffprobe、服务端中断清理代码及用户实页复验 | PASS |
| AGENT-001 | P1 | `panel.agent.expanded-empty` | 展开后画布裁切到655px、Agent 480px；建议卡与输入区坐标一致 | 截图、DOM bounds及用户实页复验 | PASS |
| AGENT-002 | P1 | `menu.agent.add-and-model` | 添加菜单、引用选择、确认模式、动态模型菜单一致 | Unboundry v2.12.4实页复核、本地状态截图、菜单交互、零Provider自动检查及用户实页复验 | PASS |
| AGENT-003 | P1 | `panel.agent.files-empty` | 文件面板 320×200、标题和空态一致 | 参考28、DOM bounds、展开/收起自动检查及用户实页复验 | PASS |
| AGENT-004 | P1 | — | Agent 操作先预览，确认后原子写入画布；真实消息/工具协议尚无证据且未接入真实Agent，禁止伪造执行结果 | `OPEN-021`、命令/graph diff | BLOCK |
| AGENT-005 | P0 | — | 拒绝、重复确认、越权文件和项目访问被安全处理；依赖真实Agent命令和权限协议 | `OPEN-021`、安全测试 | BLOCK |

## 10. 自有数据契约

| ID | 优先级 | 参考 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| API-001 | P0 | `observedContracts.canvas` | 自有 API 支持画布节点、edge、viewport、revision、项目标题和安全模型参数配置，不照抄Unboundry私有协议；说明页仅管理员可见且不会暴露密钥 | OpenAPI 3.1`/api/openapi.json`、管理员只读页`/admin/api-contract`、保存后读取端到端检查、131项全量回归及2026-08-01用户确认 | PASS |
| API-002 | P1 | `observedContracts.templates` | 模板分类、分页、搜索和 graph 数据可支撑已验收 UI | 自有`/api/templates`、26节点/31连线模板graph、界面联测及2026-08-02批量同步确认 | PASS |
| API-003 | P1 | `observedContracts.agent` | 模型、技能、建议由服务端动态配置 | 自有`/api/agent-config`、默认文字模型隔离、暂停技能/建议界面联测及2026-08-02批量同步确认 | PASS |
| MODEL-001 | P0 | — | 管理员管理节点模型目录、发布/停用/设默认；真实目录默认为空，普通用户只看到管理员已发布的显示名称，不接触Provider或内部配置 | 管理权限与节点联动专项2项、全量97项自动检查、无占位模型迁移、阶段C可恢复备份及用户实页复验 | PASS |
| MODEL-002 | P0 | Text/Image/Video/Audio真实节点 | 所有生成节点使用共享、可扩展的模型参数结构；管理员可为当前及以后新增模型设置允许值、默认值和参考素材上限，普通用户只看到当前模型允许参数；不支持项禁用且前后端均不得发送 | 参数注册表、四类节点持久化、任务模型快照、灰色自绘菜单专项检查及2026-08-01用户实页确认 | PASS |
| PROVIDER-001 | P0 | `/admin/providers` | 管理员按“平台连接→模型→节点发布”管理生成平台；第一版支持OpenRouter、火山方舟和OpenAI兼容中转站，密钥在服务端加密保存且不回显，普通用户不可访问；保存与修改均不连接外部平台、不启用真实生成 | 管理权限、加密文件、SQLite/审计无密钥、修改保留原密钥、界面零外部请求专项2项；全量108项通过、1项受控真实OSS检查跳过；2026-07-31用户实页确认通过 | PASS |
| PROVIDER-002 | P0 | `/admin/providers` | OpenRouter和OpenAI兼容连接只用GET读取模型列表验证；不得调用生成接口；错误只返回安全中文分类；火山方舟不虚构只读模型列表，添加首个模型时再验证 | 只读方法、地址、鉴权、模型计数、管理员权限、火山方舟不支持边界及零生成请求自动检查；项目构建、专项9项、全量109项通过和1项受控真实OSS检查跳过；2026-07-31用户实页确认只读连接及节点模型设置通过 | PASS |
| API-004 | P1 | `observedContracts.characters` | 角色分类、筛选、分页和总数由服务端提供 | 自有`/api/characters`、60→80加载、筛选/分页界面联测及2026-08-02用户确认 | PASS |
| API-005 | P1 | `observedContracts.library` | 个人/团队空间、文件夹、分页素材契约完整 | 自有`/api/library`、个人/团队隔离、3个本地素材、分页/总数界面联测及2026-08-02用户确认 | PASS |
| API-006 | P0 | `observedContracts.account` | 当前用户、workspace和权限来自私有服务，不依赖 Unboundry；不提供额度接口 | 自有`/api/account-context`、权限/离线检查、零额度接口及2026-08-01用户确认 | PASS |

### 10.1 多协议中转站接入

计划依据：`UNBOUNDRY_RELAY_PROVIDER_INTEGRATION_PLAN.md`。本节是本项目Provider扩展，不是Unboundry实页复刻证据。实现完成只能进入`USER_RECHECK`，未经用户实页确认不得标PASS。

| ID | 优先级 | 项目 | 验收动作与断言 | 实现状态 |
|---|---|---|---|---|
| RELAY-001 | P0 | 多协议平台连接与密钥安全 | 第三方身份、基址、协议和Key状态清晰；密钥不进入浏览器、日志、业务数据库、产物或错误响应；真实HTTPS连接绑定已校验公网IP，阻止DNS重绑定 | PASS |
| RELAY-002 | P0 | Key与目录只读检查 | 检查只调用目录GET；不得调用聊天、图片、视频或音频生成接口 | PASS |
| RELAY-003 | P0 | 目录兼容与回退 | 增强目录和`/v1/models`均可解析；分页、异常、去重和重复同步安全 | PASS |
| RELAY-004 | P1 | 模型发现UI | 搜索、节点类型/协议筛选、紧凑复选框、长文本截断和固定批量操作栏无覆盖 | PASS |
| RELAY-005 | P0 | 导入模型中心草稿 | 已选模型生成候选草稿；不自动发布、不改变默认模型、不重复创建 | PASS |
| RELAY-006 | P0 | OpenAI文字协议 | Chat Completions与Responses使用统一任务快照、结果和错误分类；两条真实结果已由用户在真实画布找到，刷新后保留且无重复 | PASS |
| RELAY-007 | P0 | Claude文字协议 | Messages协议映射准确，不根据模型名称猜协议；真实结果已由用户在真实画布确认 | PASS |
| RELAY-008 | P0 | Gemini文字协议 | GenerateContent协议映射准确，Key和原始响应不泄露；真实结果已由用户在真实画布确认 | PASS |
| RELAY-009 | P0 | 图片协议 | GPT Image和通用图片任务复用统一入参、安全素材与私有结果发布；两张既有结果经真实画布、历史、刷新和服务重启确认唯一恢复 | PASS |
| RELAY-010 | P0 | 视频异步任务 | 通用媒体提交、轮询、重启恢复、结果校验和发布完整 | PASS |
| RELAY-011 | P0 | 音频异步任务 | 通用媒体提交、轮询、格式/时长校验和发布完整；既有Doubao TTS刷新/重启后可播放且唯一，不恢复Mureka收费重试 | PASS |
| RELAY-012 | P0 | 停用、安全删除与全局回归 | 默认、节点、任务引用受保护；隔离草稿删除审计无残留，现有OpenRouter、火山方舟、Mureka和已验收画布不降级 | PASS |

2026-08-04本地真实证据：优创增强目录101条与基础目录55条合并去重为129条（文字55、图片17、视频50、音频7），用户确认分类和草稿流程通过。真实Video任务`8275d86c-602e-42ab-b444-969224dea601`按`queued→running→success`完成，后续零费用刷新、服务重启恢复和去重复验全部稳定；任务、attempt、events、素材、历史哈希不变，任务/历史/媒体均唯一。结果SHA-256为`969acbb31c7eed3ab82ecb3df88c7a2394fb5a1813ee094353a3dbeccbe9f412`、1,493,430字节、5.042秒；用户确认单节点生成成功，故`RELAY-010`为`PASS`。

2026-08-04用户授权的真实API自动验证共7次，全部成功、无失败、无重复：`openai-chat` task `ff1014f8-1e0a-415a-9ebe-7a5296a50c5f`；`openai-responses` task `b2d27319-cc77-4528-a17b-fff282b03e9e`；`claude-messages` task `f554282e-f332-4a6a-8f18-fb72bcf7bbda`；`gemini-generate-content` task `0be7fd67-c1e2-4c06-950d-76dcf46d573c`；`gpt-image` task `b4bd07a5-9a2b-47f2-8d0f-59a369aa6e71`、asset `0f98c0b7-6ec8-470c-9840-0b94c2efaaa1`；`media-generate`图片 task `2617ceee-acd7-4ccd-b2f9-cd44b3a3e4aa`、asset `12f84f21-0f2b-4c2e-836d-1b64f57dd5d0`；Doubao TTS task `d8deb41b-0a7f-428c-8242-6603c12966cc`、asset `8775c5e5-9a8e-4bcc-9d5d-4f3de68be4b2.mp3`，`audio/mpeg`、32,892字节、1.632秒。收费Provider边界由1增至8，本批后不再发起收费请求。用户先确认四条文字结果；随后又确认两张`reply ok`图片和`reply hello`音频在真实画布、历史、刷新及只重启本项目4173服务后仍完整、唯一，音频实际播放成功，因此`RELAY-006～009、011`正式`PASS`。

安全删除只使用隔离草稿`relay-delete-fixture-20260804`，其创建、归档、永久删除审计完整且当前无残留；本次用户复验没有重新造草稿或删除真实数据。真实模型中心13个模型、8个中转模型和4个默认保护项在刷新、服务重启后保持不变，隔离自动检查31/31通过，收费Provider请求0、新生成任务0、真实数据删除0。用户确认保护报告后，`RELAY-012`正式`PASS`。TTS的`emotion=auto`没有持久化或发送`emotionScale`；Mureka `RATE_LIMIT`任务未重试。

## 11. 图片高级编辑

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| IMGEDIT-001 | P0 | `legacy.node.image-result-toolbar` | 400×48工具条、九个40×40按钮、顺序和 tooltip 一致 | 参考19、bounds、自动检查及用户实页复验 | PASS |
| IMGEDIT-002 | P1 | `legacy.menu.image-more` | 更多菜单尺寸、圆角、padding、项目和切分子项一致 | 参考26、截图 diff、自动检查及用户实页复验 | PASS |
| IMGEDIT-003 | P0 | `legacy.editor.image-crop` | 全屏裁剪、编辑器/选区/底栏/比例菜单坐标一致 | 参考22、bounds、自动检查及用户实页复验 | PASS |
| IMGEDIT-004 | P0 | `legacy.editor.image-crop` | 取消零写入；确认保留原节点并新建裁剪结果节点，由原图自动连线到结果 | Unboundry用户实测、node/edge/asset检查及修正后用户实页复验 | PASS |
| IMGEDIT-005 | P1 | `legacy.editor.image-multi-angle` | 600设计宽、旋转/倾斜/缩放/方向/广角/重置状态一致 | 参考23、参数快照、自动检查及用户实页复验 | PASS |
| IMGEDIT-006 | P1 | `legacy.editor.image-redraw` | 画笔/框选/橡皮、蒙版坐标、Prompt卡与缩放映射一致 | 参考24、蒙版像素检查、自动检查及用户实页复验 | PASS |
| IMGEDIT-007 | P1 | `legacy.editor.image-lighting` | 亮度、色温、方向、轮廓光和预览几何一致 | 参考25；用户决定暂停，入口禁用且实现保留 | PAUSED |
| IMGEDIT-008 | P0 | 全部高级编辑 | 取消/失败不发布半成品；原图不可被静默覆盖 | 裁剪取消、保存失败故障注入、原/派生asset检查及用户实页复验 | PASS |
| IMGEDIT-009 | P0 | 全部高级编辑 | 无真实后端能力的按钮保持禁用，不伪造成功 | 高级编辑能力矩阵、真实disabled状态、零Provider请求及用户实页复验 | PASS |

## 12. 未知项与范围裁决

| ID | 优先级 | 未知行为 | 开始实现前动作 | 状态 |
|---|---|---|---|---|
| OPEN-001 | P1 | 拖动顶层节点到视口左/右/上/下边缘时画布沿对应方向自动移动且zoom不变；普通状态允许节点重叠，只有开启左下角网格吸附后才吸附到20px网格并阻止顶层节点重叠 | Unboundry `1280×720@2x`真实指针/DOM、用户截图纠正、本地四方向viewport、吸附开/关双状态自动检查及修正后用户实页复验 | PASS |
| OPEN-002 | P0 | resize 最小/最大、媒体比例约束 | 当前可达的Text、Playlist、两种Group组合及媒体比例均已实测并由用户验收；大型样本未观察到clamp，因此不臆造全局最大值；Storyboard/Table当前无创建入口，其完整生命周期独立保留在OPEN-019 | RESOLVED-CURRENT |
| OPEN-003 | P0 | 自连/重复/成环/角色非法、重连、独立删线 | 非法连线与独立删线均已验收；Unboundry当前普通edge无显式端点updater，本地普通edge也明确不可重连，不凭空新增成功重连；仅在后续发现其他可重连特殊edge时重新打开 | RESOLVED-CURRENT |
| OPEN-004 | P1 | 系统剪贴板跨画布复制粘贴 | Unboundry实测“复制”只在当前画布标签内生效：原画布4→5，另一个画布5→5；系统剪贴板不是节点跨画布通道。本地继续保留已通过的同画布内部复制，不发明跨画布节点格式 | RESOLVED-CURRENT |
| OPEN-005 | P0 | 视频/音频本地上传 | 合成MP4/WAV真实文件选择器上传并播放成功 | RESOLVED |
| OPEN-006 | P0 | 视频/音频下载文件结果 | 本地MP4和MP3下载均产生真实完整文件，文件名、字节及SHA-256与可播放源文件完全一致；Audio工具栏统一为项目规范后获用户实页确认 | PASS |
| OPEN-007 | P0 | 取消、失败、超时、重试、退款 | 真实任务已覆盖取消、TIMEOUT、同任务重试成功、服务重启`running→recovering→failed`及不自动重提；失败卡保留安全错误和单行重试入口；退款随用户取消全项目额度功能而不适用 | PASS |
| OPEN-008 | P0 | 多标签写冲突 | 已由`DATA-005`完成同账号双标签补测：旧revision写入返回409、服务端不被静默覆盖、重新载入恢复最新内容，并获用户实页确认 | RESOLVED-CURRENT |
| OPEN-009 | P2 | 多人实时协作 | 当前为个人小范围自用，团队项目也已由用户决定以后再做；多人实时协作随团队能力暂停，未来需要两个真实账号和同一项目权限后重新打开 | PAUSED |
| OPEN-010 | P2 | 分享、克隆、发布、团队移动 | 私有版公开发布/团队移动 | N/A |
| OPEN-011 | P1 | 创建菜单是否独立包含“图片编辑器” | 当前菜单无该项；保留历史 Image Editor 状态证据 | RESOLVED-CURRENT |
| OPEN-012 | P1 | Search 高度 440/520 的响应式规则 | 内容驱动，高度上限 `min(520px,100vh-72px)` | RESOLVED |
| OPEN-013 | P1 | Text 工具条 14项与当前较少项的关系 | selected/editing 均为 `617×48` 完整14项 | RESOLVED |
| OPEN-014 | P0 | Playlist 时间尺结束 `00:50/01:00` | 新建空态 `01:00`；历史已有内容状态 `00:50` | RESOLVED-STATE |
| OPEN-015 | P1 | Group 圆角 `12/16px` | 外层 React Flow 节点 `16px`，内层可见框 `12px` | RESOLVED-LAYER |
| OPEN-016 | P0 | 图片高级编辑提交、取消、失败和结果版本 | `IMGEDIT-001～006、008、009`均已逐项获用户确认；打光按用户决定保留实现但禁用入口并暂停，由`IMGEDIT-007`单独管理 | RESOLVED-CURRENT |
| OPEN-017 | P1 | Video结果工具栏完整十项 | 当前Unboundry十项顺序、`442×48`几何和tooltip已记录；本地Video工具栏此前已由用户确认，未接入高级能力继续保持禁用 | RESOLVED-CURRENT |
| OPEN-018 | P0 | Image/Video/Audio来源感知菜单完整项目 | Image 5项、Video 4项、Audio 2项；取消均无残留 | RESOLVED |
| OPEN-019 | P1 | Storyboard/Table完整编辑生命周期 | 当前菜单无入口，“分镜大师”也只是通用节点组合；没有真实可达路径前继续只保留已通过的历史节点载入渲染，不臆造创建/编辑/resize行为 | BLOCK |
| OPEN-020 | P1 | Group整组执行、模板更新、下载全部 | 当前无真实生成和模板后端，整组执行、更新模板保持禁用；下载全部会下载组内6个真实可用素材，专项自动检查及用户实页复验通过 | PASS |
| OPEN-021 | P1 | Agent消息、工具、确认、拒绝、失败和恢复协议 | 当前没有获准接入真实Agent、工具调用和权限协议；输入/执行保持禁用，不伪造确认、拒绝、失败或恢复结果，等真实Agent后端获准后重新打开 | BLOCK |
| OPEN-022 | P1 | `panel.agent.voice` | 用户点击后才请求麦克风；允许后本机录音可停止、预览、清除和取消，拒绝有明确提示；录音只在当前页面暂存且零Provider请求，转写因无获准服务保持未接入 | 自动允许/拒绝双路径、Agent回归及用户实页复验 | PASS |
| OPEN-023 | P1 | `panel.assets.drag-ready` | 图片、视频、音频本地素材可从素材库拖入画布，落点建节点、源素材保留、真实音频显示64段波形、刷新恢复且零Provider请求；模板搜索/预览和复杂实例证据已完成，创建/更新/失败回滚继续因无模板后端保持禁用 | 三类真实本地素材拖放、音频真实波形、graph/刷新检查及用户实页复验 | PASS |
| OPEN-024 | P1 | `1512×982@2x`、`1280×720@2x` | `1512×982@2x`固定锚点和页面无溢出；依据28张Unboundry冻结参考图，将`1280px`定为当前最小可靠支持宽度并验证同样无溢出 | DPR2截图、1px锚点自动检查及用户可见双尺寸复验 | PASS |
| OPEN-025 | P0 | 清空刷新与多标签旧状态回流 | 原Unboundry项目的未知节点来源无法追溯，但本地复刻已由`DATA-002`保证0/0刷新不复活、`DATA-005`保证旧revision返回409且不能覆盖；两项均获用户实页确认，当前回归5项通过 | RESOLVED-CURRENT |

## 13. 阶段放行

| Gate | 必须通过 |
|---|---|
| M0 | UI-001～UI-013、SURF-001 的静态部分 |
| M1 | CANVAS-001～CANVAS-017 |
| M2 | NODE-001～NODE-016 |
| M3 | DATA-001～DATA-005 |
| M4 | MEDIA-001～MEDIA-005、IMGEDIT-001～IMGEDIT-009 |
| M5 | GEN-001～GEN-010、DATA-003～DATA-004 |
| M5.1 | INPUT-001～INPUT-007；先完成P0+P1，再逐项进入用户真实浏览器验收 |
| M5.2 | RELAY-001～012全部PASS；现有真实结果与安全删除保护不再重复验收或触发收费请求 |
| M6 | PLAY-001～PLAY-004，且 OPEN-002/003/005/006/014 已裁决 |
| M7 | SURF-002～SURF-017 |
| M8 | AGENT-001～AGENT-005 |
| M9 | AUTH-001～AUTH-003 |
| M10 | 全部 P0/P1 非 `OPEN` 项 PASS，OPS-001/002 PASS，用户真实浏览器验收 PASS |

## 14. 2026-08-07 三功能新条目（待用户实页验收）

以下条目为 2026-08-07 新增三功能（我的模板 / 批量下载 / 账号私有平台密钥）的登记。实现与自动测试已完成，状态统一为 `USER_RECHECK`：未经用户在内置浏览器实页逐项确认，不得改为 PASS。

### 14.1 我的模板（自动测试：m71 专项 9/9，回归 86/88）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| TPL-001 | P0 | 打组→「创建模板」→填标题/分类→保存 | 成功 toast；「我的模板」出现卡片 | 自动测试通过 + 用户实页确认 | PASS |
| TPL-002 | P0 | 我的模板列表、搜索、分页 | 只返回本人模板，q/category/limit 生效 | 自动测试通过 + 用户实页确认 | PASS |
| TPL-003 | P0 | 卡片删除 | 删除后消失；他人删除 404 | 自动测试通过；全屏浏览 hover 删除修复后用户复测通过 | PASS |
| TPL-004 | P0 | 跨项目导入我的模板 | 找空位铺图+平滑镜头，结构/提示词/参数正确 | 自动测试通过 + 用户实页确认 | PASS |
| TPL-005 | P0 | 素材引用保留 | 上传素材 assetId 与可信元数据保留并可刷新读取 | 自动测试通过；导入即显示修复后用户复测通过 | PASS |
| TPL-006 | P1 | 封面三级规则 | 生成结果→图内素材→浅蓝渐变 | 自动测试通过 + 用户实页确认 | PASS |
| TPL-007 | P0 | 账号隔离 | A 看不到 B 的模板，删除 404 | 数据层+API 测试通过 + 用户实页确认 | PASS |

### 14.2 批量下载（自动测试：m72 专项 7/7）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| ZIP-001 | P0 | 空结果组「下载全部」 | 明确中文提示，无 ZIP | 自动测试通过 + 用户实页确认 | PASS |
| ZIP-002 | P0 | 单类型（文字）下载 | 生成 `.txt` 且内容正确 | 自动测试通过 + 用户实页确认 | PASS |
| ZIP-003 | P0 | 混合类型下载（每节点仅最近一次成功） | image/video/audio/text 打包、unzip 后哈希一致；同一节点多次成功只打包最新 | 自动测试通过（含每节点最新断言）+ 用户实页复测通过 | PASS |
| ZIP-004 | P0 | 命名与去重 | 「标题-序号.扩展名」、非法字符清洗；文件数按“每节点最新”口径 | 自动测试通过 + 用户实页复测通过 | PASS |
| ZIP-005 | P0 | 超限提示 | >500MB 或 >200 文件友好拒绝 | 单测覆盖 + 用户确认 | PASS |
| ZIP-006 | P0 | 权限校验 | 非本人/不存在画布 404 | 自动测试通过 + 用户实页确认 | PASS |

### 14.3 账号私有平台密钥（自动测试：m73 5/5、m74 3/3）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| KEY-001 | P0 | 普通账号「我的连接」页面 | 只列有已发布模型的平台；说明密钥仅本人可见 | 自动测试通过 + 用户实页确认 | PASS |
| KEY-002 | P0 | 填/改/删 key | 只返回掩码，版本递增，状态更新 | 自动测试通过 + 用户实页确认 | PASS |
| KEY-003 | P0 | 校验 key | 只读校验，valid/invalid/unknown 落库 | 自动测试通过 + 用户实页确认 | PASS |
| KEY-004 | P0 | 无 key 禁止生成 | `ACCOUNT_CREDENTIAL_MISSING` 友好提示 | 自动测试通过 + 用户实页确认 | PASS |
| KEY-005 | P0 | 坏 key 不影响他人 | A 无效不影响 B/管理员；无跨账号回退 | 专项隔离测试通过 + 用户实页确认 | PASS |
| KEY-006 | P0 | 管理员旧 key 迁移 | 迁移到管理员凭据，文档不再含 key | 自动测试通过（含方舟与手动 key 保留断言）+ 用户复测通过 | PASS |
| KEY-007 | P0 | 排队任务 key 变更 | `credentialVersion` 不符友好失败并提示重新提交 | 自动测试通过 + 用户实页确认 | PASS |
| KEY-008 | P0 | 删除账号级联 | 账号删除后凭据行清空 | 自动测试通过 + 用户实页确认 | PASS |

## 15. 阶段放行（三功能）

| Gate | 必须通过 |
|---|---|
| M11 | 2026-08-07 用户逐项实页确认通过；回归按 `TASKS.md` 记录为全绿（已知基线失败单独标注） |

## 18. 2026-08-08 画布丝滑度（实现、自动验证与用户实页确认均已完成）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| PERF-001 | P0 | 拖动节点时功能栏/创作框隐藏、松手恢复（对齐 Unboundry） | 自动回归 + 用户实页确认 | PASS |
| PERF-002 | P0 | 缩放/平移流畅（成品模式约 120fps、0 长任务、最大帧 ≤17ms） | m79 + 真实 Chrome 实测 + 2026-08-09 用户实页确认 | PASS |
| PERF-003 | P0 | 60 节点拖动流畅（成品模式约 119fps、0 长任务） | m79 + 真实 Chrome 实测 + 2026-08-09 用户实页确认 | PASS |
| PERF-004 | P1 | 200 节点可视区域渲染（快速平移节点实时挂载、缩小全量挂载） | m79 + 真实 Chrome 实测 + 2026-08-09 用户实页确认 | PASS |
| PERF-005 | P0 | 保存安静期（拖动/缩放中不写库、停手后保存，多标签/revision 语义不变） | m71/m3 自动断言 + 2026-08-09 用户实页确认 | PASS |

## 17. 2026-08-07 公共模板新条目（待用户实页验收）

以下条目为 2026-08-07 本批新增（公共模板）登记。实现与自动测试已完成，并经用户实页逐项确认，全部为 `PASS`。

### 17.1 公共模板（自动测试：m77 专项 6/6、模板批 45/46 仅余既有 m0 P1 creator 基线）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| PUB-001 | P0 | 种子迁移与公共 GET 结构不变 | v31 迁移后 2 条种子 published；公共列表仍返回同 id/标题/封面/描述/图（12/29 与 14/12 含 group） | m77/m22/m44 自动 | PASS |
| PUB-002 | P0 | 管理员新增/编辑公共模板 | 管理页新建（标题/分类/封面/图 JSON）与编辑保存生效，卡片/公共列表同步 | m77 UI/API 自动 + 实页 | PASS |
| PUB-003 | P0 | 上下架与状态过滤 | draft 不可见、published 可见、下架回草稿；管理列表按状态过滤 | m77 自动 + 实页 | PASS |
| PUB-004 | P0 | 归档与恢复 | DELETE=归档，普通账号不可见；恢复后重新可见；已导入画布不受影响 | m77 自动 + 实页 | PASS |
| PUB-005 | P0 | 种子保护 | 种子模板可编辑但不可物理删除（仅可归档）；存储层物理删除被拒 | m77 自动 | PASS |
| PUB-006 | P0 | 无权限 403 | 未授予 `manage_public_templates` 的普通账号对管理接口全部 403；授予后 200 | m77 矩阵自动 | PASS |
| PUB-007 | P0 | 管理入口按权限显隐 | 浏览全部侧栏管理员显示「管理公共模板」；普通账号不显示；路由直链无权限重定向 | m77 UI 自动 + 实页 | PASS |
| PUB-008 | P0 | 上传位导入闭环 | 管理员发布含上传位节点模板 → 普通账号导入 → 节点正常显示、不报错、刷新保持 | m77 集成自动 + 实页 | PASS |
| PUB-009 | P0 | 封面来源 | 卡片封面优先 `preview_image`；无封面回落渐变占位 | m77 自动 + 实页 | PASS |
| PUB-010 | P1 | 最近使用本地版 | 导入后按账号记录（localStorage v2）；「最近使用」倒序；失效模板静默跳过 | m77 自动 + 实页 | PASS |
| PUB-011 | P0 | OpenAPI 收口 | `/api/admin/templates` 与 `/{templateId}` 已登记（GET/POST/PATCH/DELETE），m20 契约同步 | m20 自动 | PASS |

## 16. 2026-08-07 账号权限管理新条目（待用户实页验收）

以下条目为 2026-08-07 本批新增（权限管理）登记。实现与自动测试已完成，并经用户实页逐项确认，全部为 `PASS`。

### 16.1 账号权限管理（自动测试：m78 专项 7/7、m74 大回归 106/111 仅余既有基线）

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| PERM-001 | P0 | 权限枚举与默认集 | account-context 返回 12 项权限数组；普通账号默认 5 项（项目/生成/下载/我的模板/我的连接） | m78 + m21 自动断言 | PASS |
| PERM-002 | P0 | 管理员授予/收回权限 | 账号管理页勾选保存；`PUT /api/admin/users/:id/permissions` 生效并写审计 | m78 API/UI 自动 + 实页 | PASS |
| PERM-003 | P0 | 六处守卫生效 | 无权限普通账号对账号/模型/Provider/目录/存储/生成安全 6 类接口 403；管理员仍 200 | m78 矩阵自动 + 实页 | PASS |
| PERM-004 | P0 | 前端菜单/路由显隐 | 无权限不显示入口、直链重定向到画布；授予后菜单出现且页面可达 | m78 UI 自动 + 实页 | PASS |
| PERM-005 | P0 | 账号管理页权限勾选 | 12 项 16px `admin-compact-checkbox` 网格；勾选保存后刷新保持 | m45/m78 自动 + 实页 | PASS |
| PERM-006 | P0 | 自锁保护 | 管理员不能修改自己的权限；管理员目标拒绝写入 | m78 自动 | PASS |
| PERM-007 | P0 | 超级权限保护 | `manage_accounts/manage_permissions` 对普通账号禁用且服务端拒绝授予 | m78 自动 + 实页 | PASS |
| PERM-008 | P0 | 默认能力不可撤销 | 权限写接口只维护额外授予集；普通账号默认 5 项不回退 | m78 自动 | PASS |
| PERM-009 | P0 | account-context 兼容 | `permissions` 数组与 `legacyPermissions` 布尔对象并存，前端只消费数组 | m21 自动 | PASS |
| PERM-010 | P0 | 权限变更审计 | `admin_audit_events` 记录 `account_permissions.update`（added/removed） | m78 自动 | PASS |
| PERM-011 | P0 | 删除账号级联 | 删除账号后权限行 0 残留；历史审计按既有语义清理并保留 delete_user 记录 | m78/m11 自动 | PASS |
| PERM-012 | P0 | OpenAPI 收口 | `/api/admin/users/{userId}/permissions` 与 AccountPermission schema 已登记，m20 契约同步 | m20 自动 | PASS |

## 19. 2026-08-08 部署（线上 v0.5.1 已运行；旧方案仅作历史依据，安全发布重建见 REM-009/010）

历史方案：`spec/UNBOUNDRY_DEPLOYMENT_PLAN_2026-08-08.md`。站点现已上线 `canvas.mymy.ltd` v0.5.1；其中服务器路径、Node 和费用上限等文字可能过时，本轮不得把旧方案当当前施工命令，安全发布以 REM-009/010 候选经用户确认后为准。

| ID | 优先级 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|
| DEP-001 | P0 | 公网 HTTPS 访问；手机/Win11 浏览器登录并操作同一份数据 | https://canvas.mymy.ltd 外网 200、`/api/auth/status` 正常；2026-08-08 用户实页登录成功 | PASS |
| DEP-002 | P0 | 首管理员不可远程创建；未登录/越权访问管理接口 403 | 公网 bootstrap 实测 403 + m81 + 既有 m78 权限矩阵 | PASS |
| DEP-003 | P0 | 存储写操作公网仅 HTTPS；Cookie 带 Secure | nginx 80→301；一次性临时账号经真实公网HTTPS登录，响应Cookie实测同时具有 `Secure / HttpOnly / SameSite=Strict / Path=/`，账号与会话随后删除 | PASS |
| DEP-004 | P0 | 旧本地素材 + 旧 OSS 素材 + 新素材（云路由开启后）全部可读 | 服务器数据 378 素材就位；STORAGE-004/m80 存储语义已覆盖；2026-08-09 用户实页确认通过 | PASS |
| DEP-005 | P0 | 上传 500MB 级视频成功；批量下载、播放、Range 正常 | 513,802,240字节MP4公网POST201、Range206、完整下载SHA与源同为`db3b808e…abd1`、ffprobe正常；测试素材DELETE204并确认不存在。既有自动门继续覆盖批量下载/播放器协议 | PASS |
| DEP-006 | P0 | 每日备份自动执行并上传 OSS；恢复演练通过 | schema39入口修复后timer任务上传356文件/267,091,270字节；RAM实测DeleteObject允许、ListObjects拒绝，保留逻辑改用本地签名manifest精确删除并在最终任务完成retention pass；整机离机恢复PASS | PASS |
| DEP-007 | P0 | 生成安全的总开关、紧急停止、并发/频率、连续失败冷却在公网场景生效；任务成本只作审计，不展示、不拦截 | 生产`globalEnabled=1/emergencyStop=0`，每用户/每类型并发1、每分钟5、失败阈值3/冷却30；唯一一次Doubao Seed真实文字任务一次成功、无重试，结果“真实生成验收通过”。自动门覆盖限流/熔断，不额外制造付费失败 | PASS |
| DEP-008 | P0 | 服务器重启后服务自恢复，数据/会话/任务不丢 | systemd enable+restart 多次验证 active | PASS |
| DEP-009 | P0 | 测试后门变量未设置；测试夹具/测试账号不存在 | 服务环境仅 DATA_DIR/SECURE_COOKIES/TRUST_PROXY；devFixture 仅 dev；`__test__` 已核对为 0 | PASS |
| DEP-010 | P0 | 文档收口（TASKS/矩阵/部署手册）并逐项用户确认 | 七份权威文档已按 v0.6.0/schema39 最终态同步；技术凭证与后续用户生产验收分层记录；用户于2026-08-15明确“文档确认通过” | PASS |

## 20. 2026-08-09 全量修复、优化与安全发布施工项

权威施工合同：`spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`，已于 2026-08-09 获用户确认；同日一次性离线 Goal 授权已生效。本节登记新的修复施工，不自动推翻任何历史 PASS；各 REM 按依赖顺序连续实施，不再逐项询问。文档/工程证据完成进入 `USER_REVIEW`，需要实页的产品行为进入 `USER_RECHECK`，用户确认后才能 `PASS`。

| ID | 优先级 | 验收动作与断言 | 当前证据/边界 | 实现状态 |
|---|---|---|---|---|
| REM-000 | P0 | 总方案、施工断点、项目级守则、README/交接/TASKS/矩阵入口一致；上下文恢复有硬停止点；本批零代码/测试/外部动作 | 文档级验证与三路独立复核完成；2026-08-09 用户明确确认通过 | PASS |
| REM-001 | P0 | 固定 Node 22；动态端口和逐 spec 新临时目录；拒绝 4173/真实路径；Node+浏览器非 loopback 断网；发现与执行清单覆盖全部测试；所有 Git 跟踪 TS/TSX 均有主检查或明确的独立检查 | Node 22.23.1/npm 10.9.8；105/520 精确发现与执行；TS/TSX 258/258、JS/MJS 14/14；文件/网络各 24 类负控；修复后首轮全量 520/520，0 fail/skip/retry/reportError/blocked；临时目录清理且4173监听身份不变。仅证明 runner/测试子进程真实路径访问为0，GOV-001 已记录 | USER_REVIEW |
| REM-002 | P0 | 畸形 URL 与异步异常不杀进程；日志脱敏；存活/就绪/维护/优雅关闭可验证 | 统一 JSON/URL/异步边界、UUID+8字段脱敏日志、API严格维护 allowlist、响应+handler+body+SSE 排空、精确信号所有权、后台生成 rejection 吸收均完成；readiness 不调用 openAppDatabase，核验 schema37 完整迁移账本、19表/27索引/5触发器及有限已知历史形态。m81 17/17；最终安全全量 105/536、536/536，0 fail/skip/retry/reportError/blocked；TS/TSX 260/260、JS/MJS 14/14；schema37/package0.5.1 不变 | USER_REVIEW |
| REM-003 | P0 | 加载失败不保存/不生成；同标签旧保存不能覆盖新快照；跨标签继续按 DATA-005 最后保存者胜；项目删除不复活 | F-001/F-002/F-003/F-040/F-048/F-049 已关闭；load token+epoch、session/sequence/attempt 高水位、strict journal CAS、原子墓碑与生成门禁已落地。指纹 `2ae382d4…`：专项205/205、m28十轮30/30、核心三轮450/450、安全全量107/687且687/687，全部异常计数0；源码264 TS+15 JS全覆盖；独立终审P0/P1=0；schema37/package0.5.1不变；功能提交`2a0b7f9819d3075d5fd339e20c5badd389cd51ae` | USER_REVIEW |
| REM-004 | P0 | 跨账号并发素材 ID 不互相覆盖；pending/ready/failed 和补偿闭环；每个故障点无不可见孤儿/悬空引用 | F-004、F-036 与 F-005 媒体发布子范围关闭；schema38 publication/delete/account intent、ready-only、权威尺寸、同步 adoption ACK 与只读完整性报告已落地。指纹 `f6974d…`：专项158/158、三轮474/474、全量109/762且762/762，异常计数0；源码268 TS+16 JS全覆盖；功能提交`9f1019e5686ccce4f646b54a2be6ccd5ab4864d0`。Provider付费/幂等仍归REM-005，账号删除完整合同仍归REM-006 | USER_REVIEW |
| REM-005 | P0 | 幂等、限额检查、任务插入原子；Provider 前重查停止；未知结果不重复付费；并发限额和零外网证据 | schema39 owner-scoped 幂等、原子 admission、最终付费闸、credential epoch、paid outcome、deadline、持久队列与显式 abandon 已落地；关闭 F-008/F-009/F-010，与 REM-004 一起关闭 F-005，F-014 仅 deadline 子范围。测试运行于功能提交前、HEAD `2beaec585d2d33a11341b98349b31b89b41d3a62` 的脏工作树指纹 `6a1363df8a6977e996db4b9e45aa823a89e28d6fe3955d85d6ea0ca9b315fcf9`：m81 23/23、核心6-spec三轮207/207、全量109/790且790/790，异常计数0；源码269 TS+16 JS全覆盖。功能提交`b3ceba04b5ddcf781dd58ce355be0e0f7665450e`含相同功能文件，未在commit后/文档后树重跑；单 active process 前提，F-023仍归REM-010 | USER_REVIEW |
| REM-006 | P0 | 账号含任务/媒体/模板/权限/凭据/审计时删除全成或一致失败；清理可重试；权限无修改保存不清空额外授权；KEY-008/AUTH-006 不回退 | 持久 intent + 可重试 saga、公共模板/必要媒体转交、活动/未知任务阻断、权限/凭据与 Provider/catalog/存储 actor fence 已完成；F-006/F-007/F-017A/F-033 离线候选已修，F-032 继续 PERM-011：清理旧相关审计，仅保留唯一 `delete_user`。提交前 HEAD `731b984…` 下 403-file 指纹 `9873952e…`：定向 112/112、核心三轮 222/222、全量 109/804 且 804/804 PASS，异常计数0；源码 270 TS + 16 JS；功能提交 `67cc39302d756bc00bff7ac31e31de7a7f574574` 含相同功能文件，未在 commit/docs 后重跑。仅单 active process，F-023 留 REM-010；不声称跨物理媒体或文件系统/SQLite 崩溃原子 | USER_REVIEW |
| REM-007 | P0 | 四类生成在首次/重生成/刷新/丢响应/重启/取消/失败/成功/旧结果场景恢复；更新失败不强刷；草稿不丢 | F-016/F-017B/F-018 离线候选已修；四类持久 ownership/exact GET/完整模型参数快照/fresh revision、旧预览、匹配 ownership active task 的 terminal ACK cleanup、正式付费任务 POST 未知结果 reconcile、retry/localStorage fail-closed 已收口。Workspace create/rename/delete、CanvasShell create/clone/delete 与 UpdateNotice reload-after-save 具 in-flight fence/显式失败处理；Workspace 删除核验具 deadline，ConfirmDialog 负责 busy/focus/Escape/a11y。测试运行于功能提交前 HEAD `26ff9396194499365c79e5bc85238631ed44ef7a` 下 403-file 指纹 `ce7b4856b00b3ab12ee4853ece0b07b01dec86619bbca7865daa4edb659cc957`：adjacency 142/142、target 255/255、核心8-spec三轮606/606、全量109/841且841/841 PASS，异常计数0、full deniedViteWildcardProbes477；Node22.23.1/npm10.9.8；源码270 TS+16 JS，op11=6+5；4173 hash `91689b3fefccfb3fe32ffc44e2b10a3146976b76d497183f56f7457924a7e219` 不变。功能提交 `138f7ff0f9481e73355fbd9a9fd2c548ee9cee1a` 含相同功能文件，未在commit/docs后重跑。无schema迁移；可选canvas JSON/localStorage字段兼容留REM-009B；仅单active process，不宣称跨标签互斥，F-023留REM-010；真实Mureka仍PARTIAL/暂停 | USER_REVIEW |
| REM-008 | P1 | 登录/SSE/大文件/ffmpeg/Provider/OSS 资源和网络边界受控；安全头、依赖、脚本、内存和必要包拆分通过压力验证 | F-012～F-015 离线候选范围已收口；保留500MiB合同，登录/SSE有界准入、受控流式媒体、进程/账号/磁盘reservation、ffmpeg/ffprobe有界队列与进程组终止、Provider/OSS DNS pinning/私网/IPv6/重定向拒绝、安全头、nanoid3.3.18、密码重置/存储修复及按需包/历史分页/懒加载/缓存URL回收已完成。测试运行于功能提交前 HEAD `d63af1224bbadfab00cdd65256c16afaf4195fa1` 下指纹 `79625ac9768e99351f00190389a76e19945355405a3235608f219afd4d2d81be`：核心15-spec三轮588/588、全量111/891且891/891 PASS，异常计数0、full deniedViteWildcardProbes492；Node22.23.1/npm10.9.8；源码277 TS+17 JS，op12=9+3；4173 hash `09d55bc82aab1e1f04aae60397395befd6d17c41b5b2622bcde7c4c7b1b8ec2` 不变。功能提交`ff9a2adbb9ba93c9646935b2b22b318fb5503f21`含相同功能文件，未在commit/docs后重跑。F-025只关闭密码/修复脚本子范围，`mirror-oss` / `backup-to-oss` 继续哈希冻结；F-030只收口当前可验证P2子范围；仅单active process，非跨进程/多机/OS全局配额 | USER_REVIEW |
| REM-009A | P0 | 建立真正只读的数据库/媒体/密钥备份、合成库恢复、损坏拒绝、加密与故障注入底座；备份连接绝不调用 openAppDatabase | 格式2逐文件加密+独立签名；源库只复制到私有临时目录后处理；schema37/19表+sqlite_sequence/密钥真解密/本地媒体/孤儿/假OSS版本与校验全覆盖；不可覆盖发布、marker fail-closed、路径/密钥/权限/硬链接与损坏矩阵完成。m10 9/9、最终三轮27/27、最终安全全量105/542且542/542，0 fail/skip/retry/reportError/blocked；TS/TSX262/262、JS/MJS15/15；两路独立终审无P0/P1；schema37/package0.5.1不变 | USER_REVIEW |
| REM-009B | P0 | 用最终候选执行备份恢复、v0.5.1 双向数据格式兼容、必要桥梁与迁移失败恢复演练 | 合成富数据/媒体/密钥/假OSS已完成格式2恢复、one-shot migration、故障恢复、假OSS重建和冻结v0.5.1→当前bridge→schema39数据格式与安全拒绝边界矩阵；exact v0.5.1对schema39安全拒绝，迁移后回滚目标不是v0.5.1。父HEAD`bbcd5e0…`同内容树SHA`7cf46804…`：核心三轮399/399、全量114/912且912/912 PASS，异常0；源码283 TS+20 JS，op15=12+3；listener`1be6a5…`不变。功能提交`9a158a92563814791fefb8d4e6c5531eca610d78`含相同内容，commit/docs后未重跑。同UID非协作reservation替换为残余边界；无真实数据/Provider/OSS/生产证明 | USER_REVIEW |
| REM-010 | P0 | 固定 SHA 不可变 release；三层健康检查；活动任务归零；单任务处理器；请求/SSE/generation 排空；真实双引擎、跨版本数据格式矩阵、离线切换和回滚全过 | B14→F14正式产物链、formal Linux、Node22.23.2补证、原schema37备份/离机恢复、OSS70、条件修复、schema39迁移、current切换及最终健康均已完成；F14 manifest `46e2365c…`、inventory `ac8ca43a…`、最终技术凭证 `5c78e7bc…` | PASS |
| REM-011 | P0 | `v0.5.2 / v0.6.0` 双阶段G0～G6全绿后才可进入G7；所有发现测试零失败/意外跳过/retry；三轮全新环境；用户验收；生产授权独立确认 | F14 clean targeted81/81、full2832/2832、race1420/1420及formal Linux证据均保留；生产 v0.6.0/schema39 已切换并完成技术核验，用户随后确认生成任务状态可读取。bounded cutover不冒充新controller/full run | PASS |

REM-009B的历史`USER_REVIEW`与114/912证据保持原义；REM-001～009B均未因上线批量抬为PASS。REM-010/011现为`PASS`；G5 coverage PASS、隔离G6 USER PASS继续保留为历史证据，生产另有2026-08-15 USER PASS。G7仅对本次v0.6.0发布为PASS，不授权未来发布或push/tag/PR。五条outcome-unknown attempt（86/108/116/120/122）已行政取消且禁止重试，`PROVIDER_FAILED`仅为迁移/备份门surrogate；三条音频仅修正duration元数据，媒体字节/checksum不变。
