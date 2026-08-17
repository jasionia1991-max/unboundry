# Unboundry（无央）项目交接文档

> 写给下一个接手的人/AI agent。目标：看完本文后不需要向用户问“项目在哪、怎么跑、怎么发布、有什么红线”。

## 最新已发布事件：INC-GEN-003（v0.6.9已发布并通过用户验收）

用户问版本号并同意上线。失败后系统自己去平台用量明细里配对，对得上就收回，对不上或多条相近就停住，用户不再填任务号。精确源码commit`5517eb6e4d38bbca7530562503bb962b89ba029d`通过安全全量`118/118 specs、969/969 tests PASS`，异常0，Provider/付费生成/OSS写入0。生产current为`/opt/unboundry/releases/v0.6.9-inc-gen-003-20260817`，公网资源哈希、冻结备份恢复、service/schema39及数据不变门PASS；生产保持237 tasks、239 attempts、active0、47 public templates（46 published）。`v0.6.9`已推送，PR #12已合并到`main`（merge commit`e077d09e36530a5c6830ebce9f28482a3fce0667`）。用户随后明确回复“通过”，当前状态正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。权威记录：`spec/INC_GEN_003_AUTO_RECONCILE_2026-08-17.md`与`spec/INC_GEN_003_PRODUCTION_RECEIPT_2026-08-17.json`。

## 前一已发布事件：INC-GEN-002（v0.6.8已发布并通过用户验收）

用户确认按`v0.6.8`并说「上线，发布。」同层节点一起跑时，「等保存 → 提交任务 → 写回任务号」按画布排队，平台生成仍并行，避免互相报「画布还在保存」。精确源码commit`c2e05d142a5556446d96a8532ca7297cba4e03a5`通过安全全量`118/118 specs、969/969 tests PASS`，异常0，Provider/付费生成/OSS写入0。生产current为`/opt/unboundry/releases/v0.6.8-inc-gen-002-20260817`，公网资源哈希、冻结备份恢复、service/schema39及数据不变门PASS；生产保持230 tasks、232 attempts、active0、47 public templates（46 published）。`v0.6.8`已推送，PR #10已合并到`main`（merge commit`1e1d5b482148240409e283fc19e6f3ffa66202a4`）。用户随后明确回复“看了 也通过了”，当前状态正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。权威记录：`spec/INC_GEN_002_CANVAS_SUBMIT_QUEUE_2026-08-17.md`与`spec/INC_GEN_002_PRODUCTION_RECEIPT_2026-08-17.json`。

## 前一已发布事件：INC-GEN-001（v0.6.7已发布并通过用户验收）

用户明确“那上线吧”。画布现已显示已完成生成用时；平台结果对不上时，用户在画布点「核对结果」即可收回成片或确认没有成片后再重试，不用自己去平台下图。精确源码commit`a4dc45f4cdfa30547dac401fc29d6796ba233832`通过安全全量`118/118 specs、969/969 tests PASS`，异常0，Provider/付费生成/OSS写入0。生产current为`/opt/unboundry/releases/v0.6.7-inc-gen-001-20260817`，公网资源哈希、冻结备份恢复、service/schema39及数据不变门PASS；生产保持220 tasks、221 attempts、active0、47 public templates（46 published）。`v0.6.7`已推送，PR #8已合并到`main`（merge commit`58da30589186296e0d275cdac73350f3dbec338a`）。用户随后明确回复“看了 也通过了”，当前状态正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。

## 历史事件：INC-UI-007（v0.6.6已发布并通过用户验收）

用户同意并授权一次性修复三项UI问题及完整发布收尾：Group/模板标题改为距主体约8px、72～320px宽并完整换行，且不增加组内视觉边距/边框、不改变节点坐标；Text节点只在真实编辑态阻止画布手势，浏览态可像其他节点一样拖动画布；公共模板目录在每次打开和BFCache恢复时以`no-store`重新获取，管理页改名后回到画布能刷新Dock名称。精确源码commit`31bb1e9aa6bbdf08f84fd7d5c95ab5d5ee00dbec`通过定向`17/17`及安全全量`118/118 specs、969/969 tests PASS`，异常0，Provider/付费生成/OSS写入0。生产current为`/opt/unboundry/releases/v0.6.6-inc-ui-007-20260817`，公网资源哈希、冻结备份恢复、service/schema39及数据不变门PASS；生产保持153 tasks、152 attempts、active0、47 public templates（46 published）。`v0.6.6`已推送，PR #6已合并到`main`（merge commit`6581a88c044db4e5efb8e694c4da1681defca730`）。用户随后对本轮三项修复明确回复“通过”，当前状态正式收口为`PRODUCTION_PUBLISHED_USER_PASS`。

## 历史事件：INC-UI-006（v0.6.5已发布并通过用户验收）

用户确认v0.6.5并授权全量测试、核查/恢复目标组坐标、冻结备份、发布及GitHub收尾。根因是Group订阅viewport触发测量重渲染后，被动position change被通用保存路径持久化；历史模板根组`parentId===id`自引用放大了负坐标不确定性。v0.6.5移除Group的React viewport订阅、由CanvasSurface命令式维护标题CSS变量，并在镜头安静期过滤非拖拽position change；画布载入、模板应用和组模板保存统一阻断自引用根。精确源码commit`d19e9dbf564f5806adface7807fbf7182bcdafc8`通过定向69/69及安全全量118/118 specs、968/968 tests，异常0。生产current已切到`/opt/unboundry/releases/v0.6.5-inc-ui-006-20260816`；冻结备份恢复、公网哈希、schema39和数据不变门均PASS。目标组恢复为无父级`(-1080,-1080)`，另一自引用根只移除自引用并保留坐标；登录实页72节点连续缩放无位移，`movedIds=[]`。真实Provider、付费生成和OSS写入0。`v0.6.5`标签精确指向生产源码，PR #4已合并到`main`（merge commit`0a8cfcb6c6bd1735ae921eedf2ec3b453f48493b`）；用户随后明确回复“通过”，当前为`PRODUCTION_PUBLISHED_USER_PASS`。权威凭证为`spec/INC_UI_006_CANVAS_ZOOM_POSITION_STABILITY_2026-08-16.md`和`spec/INC_UI_006_PRODUCTION_RECEIPT_2026-08-16.json`。

## 历史事件：INC-UI-005（v0.6.4已发布，待用户复验）

用户明确不要组内新增视觉边距/边框，并同意其余总览层级方案；随后单独确认`v0.6.4`版本号并授权上线、commit、push、tag和合并PR。Group标题与组框保持约20px屏幕间隔、宽度限制72～180px；15%总览默认隐藏组内节点标题，组hover或选中时仅恢复该组。不增加标题栏、内边距或边框，不移动组内节点，不改变持久坐标、连线或普通未分组节点标题。精确源码commit`ba5805c4448e504d33238947ea9aec1dfa160166`通过安全全量118/118 specs、968/968 tests；首个夹带旧dist的产物被浏览器发布门拒绝，最终fresh build已发布到`/opt/unboundry/releases/v0.6.4-inc-ui-005-20260816-r2`。公网资源、冻结备份恢复、service/schema39、数据不变和Chrome四项合同均PASS；真实Provider、付费生成与OSS写入0。当前为`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`，权威凭证为`spec/INC_UI_005_GROUP_TITLE_OVERVIEW_2026-08-16.md`与`spec/INC_UI_005_PRODUCTION_RECEIPT_2026-08-16.json`。

## 历史事件：INC-UI-004（2026-08-16，已发布待用户复验）

用户确认节点标题缩放可读性预览并授权施工及上线。普通节点标题在`zoom < 1`时按屏幕空间补偿，15%总览约12px、35%～100%约14px；颜色提亮为中高对比灰白、字重500、轻微暗色阴影，不增加底板。长标题保持单行省略和完整`title`，Group保留既有独立补偿避免双重放大，Storyboard有独立宽度上限；总览未选中标题不拦截画布指针，选中标题仍可编辑。节点/连线几何和持久数据不变。相关6份spec `16/16 PASS`，正式安全全量`118/118 specs、968/968 tests PASS`，异常0、4173不变、真实Provider/付费/OSS请求0。生产current已切到`/opt/unboundry/releases/v0.6.3-inc-ui-004-20260816`；隔离Linux启动、公网资源哈希、冻结备份恢复、active/schema39与数据不变门均PASS，tasks153/attempts152/active0及模板46/45不变。当前是`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；本次未执行GitHub动作，未来发布与GitHub动作仍须新授权。权威文档与回执为`spec/INC_UI_004_CANVAS_TITLE_ZOOM_LEGIBILITY_2026-08-16.md`、`spec/INC_UI_004_PRODUCTION_RECEIPT_2026-08-16.json`。

## 历史事件：INC-UI-003（2026-08-16，v0.6.3已发布待用户复验）

公共模板管理UI已对齐灰阶规范；特定项目返回画布失败已定位为单标签旧server-epoch pagehide journal。相同document指纹会零PUT结算并正常加载；不同内容保留journal并提供“打开服务器版本”，新标签载入权威画布且原标签恢复副本不被覆盖。正式安全全量118/118 specs、967/967 tests PASS，异常0。生产current已切到`/opt/unboundry/releases/v0.6.3-inc-ui-003-r2-20260816`，公网v0.6.3、active/schema39、NRestarts0；备份/恢复与数据不变检查通过，真实Provider/付费/OSS写入0。登录Chrome已验证目标画布恢复、公共模板返回路径、编辑弹窗UI和键盘合同；当前仅待用户肉眼复验。权威记录为`spec/INC_UI_003_PUBLIC_TEMPLATE_AND_CANVAS_LOAD_RECOVERY_2026-08-16.md`及`spec/INC_UI_003_PRODUCTION_RECEIPT_2026-08-16.json`。

## 历史事件：INC-VIDEO-001（2026-08-16，已发布且真实视频PASS，待用户复验）

Grok首帧中转协议已从`first_frame_url`修为`images`数组并限制恰好1张，定向`m57 9/9`及正式全量`118/118 specs、965/965 tests`通过。生产已切到`/opt/unboundry/releases/v0.6.2-inc-video-001-20260816`，公网v0.6.2 live/ready正常，schema39无迁移。修复后Grok请求能被正确契约受理，但中转上游两次0%网络超时，已停止重试并将默认视频模型改为`Seedance 2.0 Mini`。Seedance文生视频task`c0269665-4db5-46a1-bc13-2d5574a66cca`一次成功，4秒/480p/无音频，MP4已OSS ready，刷新后浏览器可播放；真人参考图会被Seedance内容安全拒绝，不能把该Provider限制写成应用故障。当前数据库tasks126/attempts125/active0、quick_check ok、FK0。详细凭证为`spec/INC_VIDEO_001_PRODUCTION_RECEIPT_2026-08-16.json`和`spec/V0_6_2_REAL_WORKFLOW_SMOKE_2026-08-16.json`；专用分支、`v0.6.2`标签和Draft PR #1均已同步。

## 历史事件：INC-UI-002（2026-08-16，已发布待用户复验）

用户要求一次性修复巨大Group附近框选误选、OSS素材坏媒体视觉和七类节点长标题。权威记录为`spec/INC_UI_002_CANVAS_SELECTION_MEDIA_TITLE_REMEDIATION_2026-08-16.md`。最终合同：普通节点继续Partial框选，只有Group要求选框完整包含；Image/Video/Audio保留asset/source并使用统一灰阶恢复层，CSP只在`img-src/media-src`放行`https://*.aliyuncs.com`；七类标题统一ellipsis和完整title。最终安全全量`118/118 specs、965/965 PASS`，异常0、4173不变、真实Provider/OSS/付费请求0。源码commit`8ebe705…`，生产已原子切换到`/opt/unboundry/releases/v0.6.2-inc-ui-002-20260816`，公网version/live/ready、标题、favicon、CSP和静态资源哈希通过；schema39数据、模板和并发保持不变。当前为`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`，未push/tag/更新PR。生产凭证为`spec/INC_UI_002_PRODUCTION_RECEIPT_2026-08-16.json`。

## 历史事件：INC-UI-001（2026-08-16，已随v0.6.2发布待用户复验）

用户要求设置页「返回画布」回到进入前的真实项目并新增「返回工作空间」，浏览器标签显示无央favicon和准确项目/页面标题。权威文档为`spec/INC_UI_001_SETTINGS_RETURN_AND_BROWSER_IDENTITY_PLAN_2026-08-15.md`。返回规则固定为`from项目ID → 当前账号本标签最近真实项目 → 工作空间`，默认画布不作隐式返回兜底，项目ID须经当前账号只读项目列表校验。该功能已随v0.6.2发布，最终安全full为`118/118 specs、965/965 PASS`，Provider/付费/OSS请求0、4173不变；当前为`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`。

## 历史增量：INC-ECOM-007（2026-08-15）

用户发现整组运行会把本轮尚未生成的上游Text提前判成下游Image失败。通用执行器现已改为事件驱动DAG流水：每个节点仅在全部直接生成式上游本轮成功后启动，多入参严格AND；快分支不等待无关慢分支，失败只阻塞后代；Text/Image/Video/Audio在实际提交前统一刷新runtime preflight，静态不兼容仍在零任务阶段阻止整组。正式full基线`117/117 specs、959/959 PASS`，v0.6.1准入修复后相关8份spec `110/110 PASS`，精确HEAD build PASS，Provider请求0。生产已切换到`/opt/unboundry/releases/v0.6.1-inc-ecom-007-20260815`；公网version/live/ready和主JS哈希通过，schema39、任务/attempt/并发配置前后不变，备份恢复已验证。用户随后在线上实页明确确认“通过通过”，当前状态为`PRODUCTION_PUBLISHED_USER_PASS`。权威记录与凭证为`spec/INC_ECOM_007_WORKFLOW_PIPELINE_REMEDIATION_2026-08-15.md`、`spec/INC_ECOM_007_PRODUCTION_RECEIPT_2026-08-15.json`。

## 历史增量：INC-ECOM-006（2026-08-15）

第三批P0/P1/P2共12条服装电商工作流已在用户明确“确定 发布”后单事务导入生产。恢复副本与生产写后兼容审计均为全库43/43 PASS、第三批12/12 PASS、问题0；生产43条模板、42条published，第三批12条均有graph和preview，公网12张复用封面均HTTP200 image/jpeg。发布前后tasks109、Provider attempts107、active0，并发/RPM仍全部500，Provider/付费生成/OSS变化0。用户随后明确“都通过了”，当前状态为`PRODUCTION_PUBLISHED_USER_PASS`。详细记录与凭证为`spec/INC_ECOM_006_ECOMMERCE_WORKFLOW_BATCH_3_2026-08-15.md`和`spec/ecommerce-workflow-batch-3-production-receipt.json`。

## 0. 2026-08-17 最终生产状态（当前权威）

- 当前状态：`REM-000～011（含009A/009B）PASS / PRODUCTION LIVE / INC-GEN-003已发布并完成USER PASS / INC-GEN-002已发布并完成USER PASS / INC-GEN-001已发布并完成USER PASS / INC-UI-007已发布并完成USER PASS / INC-UI-006已发布并完成USER PASS / INC-UI-005～003已发布自动与实页技术验证PASS待用户复验 / INC-VIDEO-001真实视频PASS待用户复验 / INC-UI-001/002已发布待用户复验 / INC-ECOM-001～007按各自证据边界完成用户收口`。
- 生产运行 `v0.6.9/schema39`，`/opt/unboundry/current -> releases/v0.6.9-inc-gen-003-20260817`；service active+enabled、NRestarts0、127.0.0.1:4173。公网version/root正常，version 0.6.9；默认视频模型仍为Seedance 2.0 Mini。
- v0.6.9源码commit`5517eb6e4d38bbca7530562503bb962b89ba029d`/tree`0bad75ec1b9c175ce301287879d41272bc7656d7`；上一不可变release `v0.6.8-inc-gen-002-20260817`及全部历史备份继续保留。
- 数据最新核验：schema39、quick_check ok、FK0、active generation0、237 tasks/239 provider attempts、47 public templates（46 published）。INC-GEN-003未改画布文档、节点坐标、连线、Provider或OSS；Provider/付费/OSS写入0，既有真实流水与Seedance视频结果保持。
- GitHub当前权威状态：生产源码commit`5517eb6e4d38bbca7530562503bb962b89ba029d`由注释标签`v0.6.9`精确标记；PR #12已合并到`main`，merge commit`e077d09e36530a5c6830ebce9f28482a3fce0667`。该发布授权已消费；新commit/push/tag/PR、生产或外部服务动作均需新授权。

以下条目保留v0.6.0～v0.6.8各增量发布的历史证据；出现“当前”字样时只代表该历史时点，不覆盖上方v0.6.9权威状态。
- INC-ECOM-004已为16条电商模板发布真实封面；生产18条published模板现`withPreview=18 / withoutPreview=0`。最终静态内容叠加绑定本地commit `d908c4b3824cd36638f02fec51cbe335f6aacd52`，manifest `340452f7…d7a9`、inventory `1d795f29…f464`；公网16张均HTTP200、`image/jpeg`且SHA逐项相符。用户已确认“都通过了”，状态为`PRODUCTION_STATIC_COVERS_DEPLOYED / USER_VISUAL_PASS`。
- 该叠加以当前可信formal base `5386c744…47b1`为底，只增加双目录静态文件和manifest绑定，不冒充fresh formal builder/full regression。首轮只写源码静态目录的source-only产物被公网哈希门检出并退役保留；最终产物同时包含`client/public/templates`和`dist/client/templates`。
- INC-ECOM-004回滚材料：停机备份`/var/lib/unboundry-rollbacks/inc-ecom-004-20260815T080758Z`；原formal release在`/opt/unboundry/retired-releases/20260815T080758Z-pre-inc-ecom-004/v0.6.0`；source-only产物在`/opt/unboundry/retired-releases/20260815T081400Z-inc-ecom-004-source-only/v0.6.0`。发布前后tasks109/attempts107/active0，并发500、Provider与数据manifest未变，OSS/付费生成0。
- 当前生产formal artifact（INC-ECOM-003）：commit `de0551c8187156f0283f330a39e15e5825f1f2c5`、tree `b083289ae514f6b7c7c3cdef7953065deb2c7276`、manifest `5386c74440f8868719bb7942af31437a1a2dfcbb9de28d604ccf836ddc1478b1`。前一INC-ECOM-002产物保存在`/opt/unboundry/retired-releases/20260815-pre-inc-ecom-003/v0.6.0`，更早hotfix与旧产物继续保留，不得删除。
- 数据最新核验：schema39、quick_check ok、active generation0、109 tasks/107 provider attempts、421 ready media（local351+OSS70）、pending publication0；生产生成开关沿用，per-user/RPM/Text/Image/Video/Audio均仍为用户设置的500，Provider/Storage密文配置未变。
- 原schema37 raw backup SHA `7f14c611faab136c1ae8e9579bc47755f7298e4ea6e2bba516c71e85670f8fca` 已完成离机恢复验证，inspection SHA `b4d58243e88efe1c2c967ffab5f63ed6704d18324a80e8449ec9d3ad77e28e1d`；迁移后inspection SHA `a18f8224dd651b8217cb3d778845ee3f42b5bf91a5ff68291bfad4d4cb3ffa61`。
- 封存技术凭证 `FINAL-CUTOVER-SUPPLEMENT.json` SHA `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8` 为 `TECHNICAL_CUTOVER_VERIFIED`。凭证形成时 `userAcceptance=PENDING` 不得改写；用户随后确认生成任务状态可读取，并结合此前确认老项目大量生成/上传素材仍在、第4项正常，生产另记 `USER PASS`。不声称全部历史素材逐一验证。
- 切换是人工受控 bounded cutover，不冒充新的 formal controller/full regression PASS；期间Provider/付费调用0。attempt 86/108/116/120/122已行政取消并禁止重试，`PROVIDER_FAILED`仅迁移/备份门surrogate；三条音频仅修正duration元数据12.656→12.696，字节/checksum不变。
- INC-ECOM-002已完成formal部署、停机备份和模板事务：19条模板全部静态`PASS`，99个执行节点缺模型0（published87；Text50/Image42/Video7），7处历史`Auto`已规范化；目标模板「服装详情页｜面料与工艺拆解」2个Text与3个Image节点均已绑定。回滚库在`/var/lib/unboundry-rollbacks/inc-ecom-002-20260815`，主库停机SHA `347b07f2…94a8`。零付费复核前后tasks106/provider attempts104，公网健康、登录模板面板和控制台均正常。
- INC-ECOM-003真实smoke只提交一次：目标节点`工艺拆解·完整商品`，task `e5cfd5bc-2863-4eb1-9546-4a93c76b17e7`、Provider attempt 131。参考图/OSS/预检通过，但旧专用同步路径在约121秒触发120秒deadline，任务为`failed / PROVIDER_REQUEST_FAILED`，attempt为`outcome-unknown`，没有Provider task ID和结果素材；系统没有自动重提，本次结果不能恢复。
- GPT Image同步期限已从120秒修为统一submit 180秒，定向66/66和正式full 954/954通过；上述新formal artifact已部署。停机备份`/var/lib/unboundry-rollbacks/inc-ecom-003-20260815`与旧release均可回滚；公网和数据库复核正常。该状态仅为`TIMEOUT_REPAIR_DEPLOYED`，不是图片结果PASS或USER PASS。
- 用户随后重新授权并要求控制成本：保持3:4/1K，只对同一节点再提交一次。task `9e4faf78-e466-4ae7-8799-2c9d2150bed6`、Provider attempt 132约58.6秒一次成功；ready结果asset `9f755d07-42df-47a0-9bd1-443030244a59`为PNG `1023×1537`、1,545,396 bytes、SHA-256 `ecf51e6c…ddb44`，已绑定原节点并在刷新后显示。计数只增加一个task和一个attempt，没有重试；技术smoke为`PASS`，图片内容为`USER_RESULT_REVIEW`。
- 本次成本受控单节点授权已消费。用户已确认现有结果通过；另外两图和其他电商视频未实际运行，仅作为可选付费抽验延期，不冒充真实生成PASS。REM-001～009B已因用户明确“都通过了”收口为PASS，既有外部/延后项保持原状态。
- 用户在最终切换后另行授权并完成上线能力补验：唯一一次 Doubao Seed 文字任务 `77d3feec-35c1-4b1e-87a2-c457983a8046` 一次成功、无重试，结果“真实生成验收通过”，审计成本 `10,000,000 microunits CNY`。公网Cookie、490MiB上传/Range/完整下载、schema39自动备份/30天保留与整机离机恢复均已闭环，`DEP-003/005/006/007` 与 `OPS-002` 为PASS；用户随后明确“文档确认通过”，`DEP-010 = PASS`。
- 当前运维文件：`/opt/unboundry/scripts/backup-data.mjs` SHA `e50ac515…970c5`，`backup-to-oss.mjs` SHA `05721427…7b95f`；timer active/enabled。最后自动备份前缀 `objects/backups/2026-08-14T23-15-59-569Z/`，356文件/267,091,270字节。整机离机目录 `/Users/mymy/Documents/unboundry/recovery/2026-08-15`，tar SHA `d3b6023f…ae109`，fresh restore receipt SHA `151c7886…f3962`。

## 0A. 2026-08-09～2026-08-14 全量修复施工模式（历史）

本节直到“项目一句话”前保留各时点施工证据；其中 `IN_PROGRESS / BLOCKED / HOLD / 未授权` 等描述均为当时事实，若与上节冲突以上节为准。

当时为 `REM-000 = PASS / REM-001～REM-009B = USER_REVIEW / REM-010～011 = IN_PROGRESS / G7 BRIDGE = AUTHORIZED-GATED / G7 FINAL = BLOCKED / PRODUCTION = HOLD`。B13禁止上线；B14 `3b48f61c…` / tree `c8b0d75c…` 与唯一直接子 F14 `eb4f99ea…` / tree `86b4e424…` 已形成，formal proof `517d2d24…` PASS；两版m81 41/41、tsc/source coverage/build PASS。clean F14 targeted81/81、三轮full2832/2832、两轮race1420/1420全部PASS，异常0、snapshot/listener不变、suite cleaned、均exit0；Linux artifacts待完成。用户已授权bridge全部剩余验证、真实OSS只读镜像、维护停服、备份恢复、条件修复、Node22.23.2副本补证、切换与必要回滚；动作尚未完成。

F14本地正式门绑定HEAD `eb4f99ea525390b0dd7a39d3cad55d882ffea41d`、source/snapshot `6af5b891ebf9a460e941485d12934a4a217ed3e2d6feece90d7c6d1b5ac856b1`。日志SHA：targeted `b9d260babe051c1f89ef86256ade2d57fda19b57009ec02e6973be441b5585bf`；full `1f6f958d57ee855b0272ddd2576277deef6ea3e299e5ccdc597d4ca1d4559741` / `903096ed64412e184dcefecfc28c6fedda809c17a570d3fa8729a3d176560b0b` / `adecd5164828a87452bf5974a594c19da2e00e54f4aed281c113d57240b7917a`；race `3d1b64868ef60e769158b31ee4f94efbed0015d251cfdac8b48f27f8918c5a18` / `fc08356cf3bc9eb96e8b18abdd9789b96aa615361897a205240537e2ba29eb46`。

2026-08-14 用户在隔离临时数据与动态 loopback 端口完成 G6 并明确最终通过：A 为 B13/schema37 登录、Text/Image 与画布读写，文字在固定 250×250 内自动换行；B 为真实 60 秒排空及 v37→39 migration 后，在 F13/schema39 编辑、保存、重载；C 为回切 B13/schema39 后编辑、保存、重载；final 为再次切回 F13 的最终视觉复核。rollback 后画布 API 写缺口已由 C 阶段关闭。证据 SHA-256 `d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d`。F13 阶段曾手动点击一次合成禁用 Provider `/test`，返回 HTTP 400；`generation_provider_attempts=0`、无付费生成、成功外部出站0，但不能声称所有 Provider/test 请求为0。该 USER PASS 只覆盖隔离候选，不是原生产、真实 Provider/OSS、公网兼容或发布证明。

2026-08-14 G5 外置控制器完成本地 synthetic-test 资格验证：controller SHA-256 `c78a6a367f07b72a043baf31e8d9ac80a459b029b26c4c50be7735415950b8b4`，receipt `6f2f2dcefbd45e2e1860c5017158d68ccd7a3e902bed946744725e98f098946d`，requests JSONL `49eddde273e06f33cf5aa6269d8fb3278d01d0b3eb2953d28bc3ee411d86ab23`。合成 B/F 五阶段共 `700/700` 完整且语义有效，mismatch/reset/timeout/oversize/其他传输错误均为0，观测 max `9.102ms`（非 production SLO）；六类 loopback 状态机自测 PASS，4173 既有 listener 身份前后不变。该 receipt 明确 `formalG5Evidence=false`，不能升级为 Linux formal artifact、原生产或发布证据。

2026-08-14 同日，用户以“ok 授权 go”确认 DEC-REM-007 后，既有第二台非生产 Linux 验证机以单次不可变审批绑定完成 formal supplement。executionId `61b1b5dfab2e78ec4fd8d93a2caa13af3f3e724cadb489133ff6b0e191d8e755`，approval `dfc267e115b2278a30c8f6b214fe30bef05abe7f0075856fc3686b5cfecccc6b`，wrapper/controller/helper `74e63ac68dd6a42f89f37dd577219adff5a4b3de320108a6e3f932aa2d8a4e43` / `41d5173e399a4b9dae0161e9d357254d5f4c6d6685af8c8b3b223cef83b82adb` / `46ec2a44fa71ba84eac7ffc02a561fedbe0a5550d3a6fa257cb8404b01d000c4`。outer receipt `PASS / formalG5Evidence=true` SHA `ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b`，inner candidate `380ec25897f8d642c379301a313a572eb20d31e75a1ffefcc454a89487b64ad0`，requests `15d69b90ffdd4a686fd3653f664c0ec90f933281e16757f57ce07f13e5f43a92`。B37/B39/F39/B39_ROLLBACK/F39_RESWITCH 五阶段每阶段140，共`700/700`，传输错误均0；p50/p95/p99/max `24.633/74.981/89.501/103.58ms`，deadline2000ms，`productionSlo=false`。六类状态机PASS，final schema39 integrity ok/FK0/marker absent/Provider attempts0，Provider/OSS/付费workload0，private net/process/caps均0；host before=after `5474649e…`，4173=0、uid996=0，旧roots/services/nginx/原生产路径不变，root sealed、cleanup0。G6 C 已关闭 rollback API write，因此 G5 coverage 为 `PASS`。延迟数字不是原生产 SLO。

2026-08-14 原生产 bridge 只读预检补充：现场为 `unboundry.service`、`/opt/unboundry`、Node22.23.2、schema37；`integrity_check=ok`，但 `foreign_key_check` 精确有 `project_metadata rowid=14` 一条孤儿。该行仅可在维护、旧服务停止、无写者、可恢复备份及精确前后复核成立后删除，目前未执行。B13 被 `asset_history=0053af18…65300` 与 `provider_profiles=47a50d88…d87e2` 两个历史等价 raw SQL hash 拒绝；完整 pragma 语义一致，因此选择 B14/F14 两门 exact full-hash allowlist，而不重建生产表。Node22.23.2 waiver 不修改 formal manifest，必须另做恢复副本兼容补证。70个 ready OSS 对象仍缺可信 versionId 镜像；用户最新已授权真实 OSS 只读 HEAD/GET 与 bwrap，但必须取得完整镜像并通过正式备份门后才能写库或切换。

历史 REM-009B 证据保持为：父 HEAD `bbcd5e0f6ca2096ed433d5ac45019c19aab50c53` 的同内容脏树、source SHA-256 `7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b`，核心三轮 `399/399`、安全全量 `114/114 spec、912/912 PASS`，源码 `303 = 283 TS/TSX + 20 JS/MJS`、运维脚本 `15 = 12 行为 + 3 冻结`；它不是当前 REM-010 结果、用户 PASS、真实数据/Provider/OSS、生产迁移或发布证明。

`1e96e26f…` 属于 m92 fixture 窄修复后、上一轮六文档同步前的脏功能树。此后用户实页发现 default 卡片错误路由和 Video 重复 Prompt 两个自动检查缺口；当前候选已修正并由 m11+m30 安全定向 `17/17 PASS`（源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be`、零任务/零付费 Provider、4173 listener不变）。用户随后在端口 58352 的隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。页面修复后的首轮 full `930/931` 唯一暴露 m44 协作 current-open reservation 创建/释放竞态，属于真实产品并发缺口；产品协议修复后 m44+m91 targeted `15/15 PASS`，fresh full 为 `117/117 specs、931/931 PASS`，异常计数全0、denied534、builder 1/3/1/0。证据绑定 HEAD `9a76edc3…` 下 429-file tested source snapshot `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，4173 listener不变，suite cleaned、exit0。

上述脏树先冻结为 candidate `b9b4691a1d06d8321578b7552ea5e14b23fb85e2`，但两个 OS 进程 Provider save 压力运行被最后旧 SQLite writer 关闭时的真实 WAL/SHM 交接竞态击穿，故该候选失效。最终 `8b639ffe…` 采用 held-reader 窄修复：完整 WAL/SHM 对（含 zero-byte WAL）用普通只读 inspection，并把读事务保持到新 writer 取得 `BEGIN IMMEDIATE`、完成 identity/sidecar/schema/digest 复核后再释放；不安全替换仍 fail-close，m91 对 hot-WAL 与 zero-WAL 均有确定性回归。

Docker Ubuntu 子门的 rootless-userns 阻塞已按设计 fail-close。随后用户只授权第二台、非原生产 Ubuntu 24.04 x86_64 验证机：首次 production builder 发现空 `@playwright` scope 误判并 fail-close，窄修复后 r2 对一次性 clean ephemeral commit 真实 PASS。tar SHA-256 `a322ec21affe7c2e73c510fceb74d5c953bee213b25084954b735f18d7be494b`，commit `ef206cd3dcc94ea6657a12ab7963580fe4e9bb5c` / tree `ab68ce7d3725869e674a7b7a7c3fdb0b74e5d29e`，`formalReleaseCommit=false`；manifest SHA-256 `79e5d45dfbb9e51ec7fc60e1f5527a11f30f1d3d9638b682741c4306a25db02a`，5270 条 inventory 一致，release 0500、无 `.incomplete`，bwrap 网络 namespace 探针通过，构建步骤未观察到外网尝试。active/maintenance `nginx -t` 与 `systemd-analyze verify` PASS，现有 nginx/Docker 未修改/reload/restart，4173 为 0。这些结果只保留为旧 builder/ops/core 基线，不证明真实双引擎 bridge。该历史时点双版本离线门尚未完成；随后 formal B13/F13 曾完成，但现又被生产 raw-SQL gate 迫使重铸 B14/F14。该历史时点原生产、push/tag/PR/release/production均禁止；现行授权与 HOLD 边界以上文最新段落为准。一次独立审计曾越权对 `app/data` 执行 immutable 只读聚合查询，结果未纳入证据、写入和外部请求为 0，之后未再访问。

当前冻结方案：`v0.5.2` 是单一不可变双引擎 bridge，外层 supervisor 唯一监听并统一承担 role/lease/drain，启动先只读探测 schema。schema37 只开放登录/会话、项目/画布等基础业务读写与既有媒体读取；生成提交/重试/取消、上传/删除/发布等高风险 generation/media mutation fail-close，离线验收 `generation_provider_attempts=0` 且成功外部出站0。schema39 使用内嵌 v0.6.0-compatible 引擎提供完整回滚；schema38/未知版本维护态拒绝。启动/健康不迁移，显式 migrator 只在维护、排空和备份后运行。`v0.6.0` 是独立 final。四项 P1 已收口：exact-old child 的受控 PATH/显式 duration backfill、bridge/final 共用且反复认证的工具先决件、只允许 package/lock 三处版本变化的 source-pair 证明，以及 m92 从认证 manifest 启动两个产物和调用产物内 migrator。首轮关键七 spec `74/75` 的唯一失败是测试 `fetch` 未保留生产 Host；产品严格代理头未放宽，改用 `node:http` 并补生产头正反例及 Cookie 安全属性后，m92 `2/2`、最终关键七 spec `75/75`。该段是 pre-formal 历史；formal B13/F13 与完整证据以上文为准。未来 bridge 与 final 各需一次独立原生产授权。当前必须先读：

1. 仓库根 `AGENTS.md`；
2. `README.md`；
3. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`；
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；
5. 本交接文档；
6. `TASKS.md` 与验收矩阵当前 REM 区块。

`REM-000` 已为 `PASS`。本轮 Goal 的允许动作、决策默认和停止边界已写入施工断点；恢复者不得把这份离线授权扩张到任何生产动作。

## 1. 项目一句话

一个 TapNow 风格的 AI 画布应用（React + Vite + Node 原生 SQLite），支持文本/图片/视频/音频生成节点、连线工作流、模板、多项目工作空间、账号与管理员权限。当前**已发布到生产服务器** `canvas.mymy.ltd`，线上版本 `v0.6.6`、数据库 schema39。

## 2. 仓库与环境

- 仓库根：`/Users/mymy/Documents/unboundry/app`（注意：系统工作区根目录写的是 `tapnow1_1复刻`，那个路径在本机不存在，**一律用 unboundry/app**）。
- Git：当前专用分支 `codex/unboundry-offline-remediation-2026-08-09`已推送到远程`https://github.com/jasionia1991-max/unboundry.git`；注释标签`v0.6.6`精确指向当前生产源码commit`31bb1e9aa6bbdf08f84fd7d5c95ab5d5ee00dbec`；PR #6与文档PR #7已合并到`main`。旧`v0.6.5`/`v0.6.2`/`v0.6.1`标签只保留历史生产边界。
- Node：formal 构建/验证固定 `v22.23.1` 与 npm `10.9.8`；生产 `/opt/node22/bin/node` 为 `v22.23.2`，production-specific waiver及恢复副本补证已完成。formal manifest的22.23.1绑定仍不改写，也不把旧Linux receipt冒充实际22.23.2 runtime证据。
- 历史依赖/检查方式曾为 `npm install`、`npx tsc --noEmit`、`npm run build`，仍不得直接作为施工入口。当前唯一安全总入口是 `node scripts/run-safe-tests.mjs <preflight|list|run|full>`；它在跟踪文件隔离快照内用 `npm ci --offline --ignore-scripts` 准备依赖，并统一执行源码、构建、重启和测试门禁。
- 代码结构速览：
  - `client/src/canvas/`：画布（`CanvasSurface.tsx` 是核心，`CanvasShell.tsx` 是外壳）、各类节点（Image/Text/Video/Audio/Group…）；
  - `client/src/generation/`：生成提交、轮询、错误文案；
  - `client/src/projects/`：工作空间；
  - `server/`：所有 API 与业务（`auth.ts` 账号/会话/权限、`generationSafety.ts` 并发/频率/熔断、`generationTasks.ts` 生成任务、`modelCatalog.ts` 模型、`projects.ts` 项目、`canvasPersistence.ts` 画布存取、`database.ts` 迁移）；
  - `vite.config.ts`：把所有 `server/*` API 挂到 `/api/*`（dev 与 preview 都注册）；
  - `types/`：跨端共享类型。

## 3. 历史命令清单（FROZEN，不是当前授权）

以下命令只用于解释旧项目历史，REM-001/009/010 对应安全替代完成且用户另行授权前，**禁止直接执行**：

- `npm run dev`：会使用真实本地 4173 和 `app/data`；施工测试禁止；
- `npm run build` / `npm run check:greenfield`：只在对应 REM 获授权并进入隔离工作区后执行；
- `npm run data:backup`：REM-009A 已改为显式 `--source-frozen`、绝对路径和包外密钥的加密入口；本离线 Goal 仍禁止把它指向 `app/data`、生产或任何真实数据，真实备份必须等用户另行授权；
- `node scripts/deploy.mjs --version X.Y.Z`：旧一体化入口现已立即 fail-close；B13/F13 自动与用户证据只作回归基线，REM-010/011 因 B14/F14 重铸为 IN_PROGRESS。bridge准备授权不放开G7或旧发布入口，禁止执行任何替代发布入口；
- `node scripts/reset-account-password.mjs ...`：离线候选已改为默认 dry-run，apply 需要显式可信数据目录、目标账号、有效管理员 actor 与隐藏 TTY 或私密绝对密码文件；真实账号应急操作仍必须另获用户明确授权。

## 4. 测试纪律（非常重要）

- **绝不**用真实数据/真实 4173 跑测试：所有测试用临时数据目录 + 独立端口。
- 2026-08-09 全量审计确认：旧推荐回归组合去重后只覆盖约 80/105 个 spec、391/519 项既有测试，且多处使用固定端口、共享临时库或仓库 tmp。它们只能作为历史基线，不能作为新候选的“真正全量”绿灯。
- REM-009B 历史安全清单精确覆盖114个spec、912项测试；`8b639ffe…` core 基线发现117 specs/931 tests，三个独立全新环境full各931/931、合计2793/2793，两包5-spec竞态压力各570/570、合计1140/1140。每个spec使用独立新临时目录与两个动态loopback端口；Node/浏览器禁止非loopback与未登记本机端口；safe runner/tests真实路径成功访问为0。F-054 发现当时，这些结果不覆盖新 supervisor/双引擎/双产物，不能使 REM-010/011 进入 USER_REVIEW，`v0.5.2 / v0.6.0` 必须分别重新发现和验证；该重验现已由下一条 formal F13 证据完成。REM-008的历史891/891与旧指纹同样不冒充当前inventory。
- pre-formal 桥梁源码发现为 `117 specs / 938 tests`，Mac synthetic direct-child/artifact 定向门为 `75/75 PASS`；它永久只是历史过程证据。formal F13 最终发现 `117 specs / 942 tests`；targeted `79/79`，三轮 full `942/942 × 3 = 2826/2826`，两轮六 spec `repeat 10` 为 `690/690 × 2 = 1380/1380`，异常计数全 0。五轮绑定 F13、443-file source/snapshot `b36a20db…`，snapshot 与4173 listener身份不变、suite cleaned。
- 隔离 Linux production-validation 外层 receipt SHA-256 `8f1ea00385828327d81bc7c9f9f7ef71a48fe87c58d6cb190ce45953a59c36eb`，实际完成 B37→B39→F39→B39 rollback→F39 reswitch、schema37→39迁移、60秒drain、native duration probe/backfill和备份恢复，成功外部出站0；未连接或修改原生产。F13非根234节点依赖图与REM-008历史audit0图一致，但不是fresh audit。
- 默认 `npm run verify` 与下面固定端口配置仍是冻结历史，不得绕过安全总入口；`package.json` 中旧测试脚本已改为 fail-closed 或转入安全入口。
- 历史通用测试配置：`--config=playwright.4174.config.ts`（端口 4174、临时数据目录、auth bypass）。
- `npm run verify` 现已委托给安全总入口；仍禁止直接调用 Vite、默认 Playwright 配置或下列历史固定端口脚本绕过 runner。
- 端口地图（每套件独立 config）：
  - 4174：通用（playwright.4174）
  - 4175：m58；4176：m14（config webServer）/m60；4177：m61；4178：m62；4179：m63；4182：m64；4183：m65；
  - 4191：m77；4192：m71 回归；4193：m72/m79；4194：m11/m73；4197：m74 回归；4198：m75 全量、m78（m14 的 spec 内部也自拉起 4198）。
  - 说明：m11/m77/m78 等“无 bypass”套件在 spec 内部自己拉起端口和临时目录；单元类 config（m38/40/47/49/53/54/55/57/59/model-runtime）多为纯 Node，不需要 webServer。
- 历史回归组合：`tests/m75-full.config.ts`、`m71-regression`、`m74-regression`、`m79`、`npm run test:restart`、fixture-production；它只覆盖约 80/105 spec、391/519 项，禁止称为最终全量。
- 日常与候选迁移测试只允许程序化合成的旧 schema 数据；未获真实数据专项授权，不得复制、打开或迁移 `app/data`。

## 5. 服务器运维事实

- SSH：`ssh live-cockpit`（`~/.ssh/config` 已配置，腾讯云轻量）。
- 服务：systemd `unboundry.service`、release `/opt/unboundry/releases/v0.6.6-inc-ui-007-20260817`、current `/opt/unboundry/current`、数据 `/var/lib/unboundry`、监听 `127.0.0.1:4173`；上一`v0.6.5-inc-ui-006-20260816`完整保留，旧 `unboundry-replica.service` / `/opt/unboundry-app` 仅为历史计划。当前上线事实不授权未来 stop/restart/current切换。
- **历史风险事实**：现有 v0.5.1 preview 会在首次数据库请求（如 `/api/auth/status`）时懒迁移/回填。新施工禁止用健康接口“激活迁移”；REM-009/010 必须将就绪检查与显式迁移完全分开。
- **历史运行事实**：本地 4173 有守护进程可能自动拉起。当前 REM 施工禁止 kill、重启、探测或复用 4173；旧的黑屏重启处理不是当前施工指令。
- 版本更新推送：`/api/version` + `/api/updates`（SSE），发布后用户端会弹“版本已更新”提示，属于正常机制。
- 真实账号现状（服务器库）：`mymy`（麦哥，admin，`protected=1` 最高权限）、`zzx`（user，`protected=0`）。密码不写在任何文档里。

## 6. 历史发布流程（FROZEN）

旧 `deploy.mjs` 仍为 fail-close 历史入口，禁止复用。B14/F14、formal Linux、备份/恢复、迁移与最终切换已由本次受控流程完成；这不把旧入口变成未来发布许可。

历史版本接口检查不打开数据库，不能证明登录、画布、媒体或迁移正常。新流程必须以施工总方案 REM-009/010 和 G0～G7 为准；不 push、不部署未经用户确认的内容。

## 7. 红线（延续项目一贯纪律）

- 不修改/不删真实数据（本地 `app/data`、服务器 `/var/lib/unboundry`）；测试一律临时目录。
- 不发起任何真实或付费 Provider 请求；本轮只用本地假 Provider，不得因“可能免费”而调用真实平台。
- 不 `git reset --hard`、不 `clean`、不覆盖他人改动。
- 迁移前必须备份 + 副本演练。

## 8. 账号与权限设计（v0.5.1）

- 受保护最高权限账号（root）：第一个创建的管理员（mymy/麦哥）自动 `protected=1`；其他管理员永远不能停用/删除/降级/重置密码/改权限它；root 自己也不能在网页上改自己角色/删除自己。
- 多管理员：账号管理页创建账号时可选“普通用户/管理员”；管理员之间可互相管理（停用/删除/改角色/重置密码），但动不了 root。
- 密码重置三层：自己改密码（头像菜单，需旧密码，吊销其他会话）；管理员重置他人密码（root 除外，吊销全部会话）；应急脚本 `reset-account-password.mjs`（SSH 执行，可重置任意账号含 root）。
- 权限：管理员恒有全部权限；普通账号默认能力不可撤销，只维护“额外授予集”；`manage_accounts/manage_permissions` 等管理权限不授予普通账号。
- 生成安全：金额限制/上限功能已整体移除（v0.5.0），保留总开关/紧急停止/并发/频率/熔断/失败阈值；任务成本仍记账（审计参考，不展示不拦截）。

## 9. 验收状态速览

- 已 PASS：GEN-010、SAFETY-004、AUTH-004/005/006/007、STORAGE-004、PERF-002～005、DEP-004，以及更早的大批项目；2026-08-13 新发现缺口修复后，用户又在端口 58352 的隔离实页确认默认画布路由与 Text→Video Prompt 两项均通过，CANVAS-019 与 INPUT-005 也已恢复为 `PASS`。
- `CANVAS-019 / INPUT-005` 保持用户 `PASS`。INC-ECOM-001～007已按各自证据边界完成用户收口；REM-000～011（含009A/009B）均为`PASS`。旧B13/F13 G5/G6和v0.6.0生产USER PASS继续保留为历史证据。
- 暂停/延后：Mureka 真实生成（AUDIO-REAL-001，需用户在 Mureka 官网确认额度）、IMGEDIT-007 打光、AUTH-002/OPEN-009 团队多人、OPEN-019/021、正式部署流程收尾（域名/备案等）。

## 10. 历史测试失败/偶发记录（当前冻结全量已全绿）

- 已知基线：m0 `P1 creators...Dock`、m17×2、m24、m25、m30×5（Node 25 环境）、m33:690、m46:540、m62:92、m63:219、m7-agent-voice；m14 在 m75 全量（bypass 服务器）里失败属环境组合，单独跑 `m14-generation-safety.config.ts` 是 3/3。
- 机器偶发（单独复跑通过或基线复现）：m2-audio:70、m4-audio:98（headless 音频播放不推进，基线复现）、m2-group:131（基线复现）、m70:176（保存闸门时序，基线复现）、m0:1661、m27:1146、m33:445、m4-image:328、m66:319、m37:215、m41:395、m69:126、m79:128。
- 上述仅是旧运行记录，不是当前允许忽略的失败清单。REM-008 冻结功能树已由安全入口完成 111 spec / 891 tests 全量且零失败、跳过、重试、report error 或 blocked；任何后续新失败都必须重新归因，不能沿用旧豁免。

## 11. 数据库迁移

- 机制：`server/database.ts` 的 `migrations` 数组顺序执行；线上已迁移到schema39；v0.5.1/schema37与schema38是历史基线/中间候选。
- 真实库：本地 `app/data/unboundry.sqlite`；服务器 `/var/lib/unboundry/unboundry.sqlite`。
- REM 日常/候选演练：只使用程序化合成的旧 schema 数据，禁止复制或打开本地真实 `app/data`。生产备份副本只可在用户另行授权的发布窗口按 REM-009 规则验证，并必须断开外网、禁用 worker/Provider/OSS、禁止写测试行。
- 历史迁移 v36（移除金额限制列）、v37（users.protected）已上线并验证；m44 有“当前库回退到 v18 重放迁移”的夹具，改动迁移时必须同步更新该夹具与 m44 期望清单。
- 已上线 v1～v37 迁移不可改名、改版本号或修改既有 SQL，只能追加新迁移；文件/secret/OSS 迁移必须另有 journal、幂等重试和补偿。
- schema39已在原生产完成显式迁移并由F14 v0.6.0运行；exact v0.5.1不能连接该库，回滚目标必须是兼容bridge。原schema37 raw备份与离机恢复证据继续保留，不能在已恢复用户写入后擅自覆盖生产库。
- REM-007 本身没有新增 schema 迁移；四类 ownership 为可选 canvas JSON/localStorage 字段，legacy 数据继续按 exact signature/ownership fail-closed。其格式与拒绝边界已由 REM-009B 矩阵覆盖，不能用“schema 未变”代替。current-database-open reservation 只序列化协作打开；同 UID 非协作进程仍可替换该极窄路径，这是已声明残余边界，不承诺 REM-010 自动消除。

## 12. 记忆参考（同一台 Mac 的 Codex）

`~/.codex/memories/MEMORY.md` 与 `rollout_summaries/` 记录了本项目的历史脉络，可作背景参考；**以仓库文档为准**，记忆可能滞后。

## 13. 与用户协作偏好

- 中文沟通；用户是代码小白，解释要“人话 + 结论先行”。
- 先分析给证据/方案，确认后再动手；诚实标注“未验证/未确认”，禁止编造测试结果。
- 每个功能验收后同步 TASKS.md/验收矩阵；发布版本号递增（当前生产线为 0.6.x）。
- 本轮七份权威文档必须保持同步；当前没有施工中的REM。任何未来施工必须先建立新断点和新授权，不得复用已消费的bridge/final授权。

## 14. 接手自检（按顺序跑一遍）

先执行 `AGENTS.md` 和施工断点中的恢复协议。以下命令是历史接手自检，不是安全施工入口；已完成的生产上线不构成未来stop/restart、数据库写、OSS访问、迁移或发布授权。

```bash
cd /Users/mymy/Documents/unboundry/app
git status && git log --oneline -3
npm run check:greenfield
npm run build
npx playwright test --config=tests/m11-auth.config.ts
npx playwright test --config=tests/m14-generation-safety.config.ts
ssh live-cockpit "curl -fsS http://127.0.0.1:4173/api/version"
```

即使历史命令全部通过，也只能证明这些定向检查当时的结果；不能代表 REM 全量测试、数据库、生产安全或用户验收通过。一次性离线 Goal 只授权 REM-001 安全入口完成后的隔离构建和 Playwright；第二验证机授权不得扩张为原生产 SSH 或发布。

## 15. 后续候选（不属于本次发布收口）

- 正式部署流程收尾（域名/备案/HTTPS 加固确认）；
- Mureka 真实生成恢复验收（需用户确认官网额度）；
- 密码找回的网页入口（当前 root 忘密码走应急脚本）；
- 团队/多人协作（AUTH-002 范围）；
- 部署矩阵中仍为 `PARTIAL / NOT_STARTED` 的独立收尾项（Cookie Secure、多设备/大视频、公网生成、备份清理等），需按用户后续任务逐项推进。

## 16. 上下文压缩或换 Agent 的恢复协议

1. 完整阅读 `AGENTS.md`、施工总方案和施工断点；
2. 只读核对仓库路径、分支、HEAD、工作树、package 和 Node；
3. 对照断点确认当前 REM 状态（可能没有施工中的项）、最后完成项、下一步和用户授权；
4. 再读取 TASKS 与验收矩阵对应 REM 区块；
5. 向用户先报告恢复出的项目、版本、当前项和授权；
6. 任一不一致都必须停止，不得依据内部记忆、历史 PASS 或压缩摘要猜测继续。

当前执行点：`INC-GEN-003 PRODUCTION_PUBLISHED_USER_PASS / INC-GEN-002 PRODUCTION_PUBLISHED_USER_PASS / INC-GEN-001 PRODUCTION_PUBLISHED_USER_PASS / INC-UI-007 PRODUCTION_PUBLISHED_USER_PASS / INC-UI-006 PRODUCTION_PUBLISHED_USER_PASS / INC-UI-005～003、INC-UI-001/002、INC-VIDEO-001 仍为已发布待用户复验 / INC-ECOM-001～007 USER ACCEPTED / REM-000～011（含009A/009B）PASS / PRODUCTION LIVE`。生产已为v0.6.9/schema39；current→`v0.6.9-inc-gen-003-20260817`。未实际运行的付费两图/视频抽验继续延期。
