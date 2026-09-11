# Unboundry 当前生成与画布结构

更新日期：2026-09-07。本文维护本项目的结构、职责和行为边界；产品版本、部署、性能结论及未决事项只由 [CURRENT_STATE](UNBOUNDRY_CURRENT_STATE.md) 维护，授权见 [当前任务](../TASKS.md)，逐项验收见 [总矩阵](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。上游观察另见 `UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`，不能据此前端材料推断上游内部架构。

2026-09-07按当前代码与发布验收证据纠正旧状态描述，核对范围见当前任务；没有因此重跑全部功能或真实生成。2026-09-06的逐文件查阅深度保留在 [历史源码清单](PROJECT_SOURCE_REVIEW_COVERAGE_2026-09-06.tsv)，代码存在不等于所有Provider/模型都已真实验收。

## 1. 结构和职责

系统是React/Vite前端、Node服务端、SQLite持久化及媒体存储组成的单体应用，已形成模块端口与组合根，并非只有前端工作流，也没有因模块化而拆成微服务。

| 范围 | 当前入口与职责 |
| --- | --- |
| 页面、工作空间 | `client/src/App.tsx`；账号/项目/画布与版本更新提示 |
| 画布交互 | `client/src/canvas/CanvasSurface.tsx`及节点组件；本地交互、命令提交、服务端结果应用 |
| 输入语义 | `types/nodeInputs.ts`、`types/modelInputSemanticCompiler.ts`、`types/workflowSemanticPlan.ts`；解析入边、角色、顺序、提示词和模型输入合同 |
| 组合根 | `server/applicationComposition.ts`；组合auth、canvas、generation、imageTools、library、media、provider及Seedance专属接口 |
| 请求准入 | `server/generationTasksApi.ts`、`server/generationAdmissionApplication.ts`、`server/generationTaskStore.ts`；身份、模型合同、幂等及持久任务绑定 |
| 服务端工作流 | `server/workflowRunsApi.ts`、`server/workflowRunService.ts`、`server/workflowRunLocks.ts`；持久run/node、依赖推进、公平调度、停止和结果结算 |
| 生成与Provider | `server/generationTasks.ts`、`server/mediaGenerationProvider.ts`、`server/providerRuntimeApi.ts`及各Provider runtime；提交边界、任务查询/恢复与结果归一化 |
| 素材发布 | `server/mediaPublicationService.ts`、`server/mediaBlobStore.ts`、`server/generationResultCommit.ts`；媒体对象、staging、publication和任务结果登记 |
| 画布投影 | `server/generationCanvasProjectionService.ts`、`server/canvasWorkflowProjection.ts`、`server/canvasMutationGateway.ts`；按精确绑定把结果写入Canvas，独立记录同步失败 |

2026-09-06历史架构扫描：298个应用TS/TSX文件，1039条runtime边、274条type边；88条登记例外（73跨域SQL、12跨域internal、3Provider/Storage），新增、失效和无效项均0，runtime SCC为0。本次没有重跑该扫描；这些计数只证明当时的静态合同检查通过，不证明零耦合或当前全部函数无缺陷。

## 2. 当前生成链路

```text
单节点输入 / 模板组输入
  → 输入解析与零费用preflight
  → HTTP单节点准入 / 服务端持久workflow准入
  → authoritative模型配置、owner/canvas/node/revision/幂等检查
  → 事务保存任务及绑定，再启动同一个任务
  → Provider attempt边界 → 提交或核对原任务
  → 文字结果 / 媒体字节与publication保存
  → task结果结算 → workflow节点结算（若属于workflow）
  → 精确Canvas投影 → 客户端逐节点应用并显示
```

统一输入与服务端workflow都已经实现，不能继续标记“计划中”。具体可提交能力由当前已发布模型合同、Provider连接/驱动、输入及安全门共同决定，范围包含text/image/video/audio；不能概括为“仅图片和视频可提交”，也不能据此宣布Mureka等真实生成已经验收。

工作流准入还受`server/modelExecutionRegistry.ts`的恢复等级限制：ark-text、ark-video、mureka-audio、relay-media标为eligible；同步openrouter-image、relay-gpt-image不具备同等级结果找回证据，强工作流准入为false。单节点可用不等于可放入工作流；eligible也不是生产验收结论。

浏览器不持有Provider密钥，不直接把任意外部URL或本机路径当作可信素材。服务端复核owner、asset、类型、ready、模型输入合同与绑定；不可变输入/模型身份用于后续核对。短时签名地址属于Provider传输材料，不应成为画布持久事实。

`admitPreparedGenerationTask`由HTTP和持久workflow共用；先提交任务再启动。现代单节点在同事务绑定Canvas；workflow有自己的run/node绑定。响应传输失败不代表准入未成功，不能靠重复POST判定或“修复”。

### 2.1 浏览器对原任务的状态观察

`waitForGenerationTaskWithPause`对确认的网络失败、单次10秒读取超时和HTTP 5xx进行有限重查：前两次分别等待1秒、2秒，第三次连续失败才暂停；合法状态返回后计数归零。手动重新检查建立新的观察会话。部署与验收阶段见当前状态和当前任务，不能据此认为线上已启用。

该策略只包住一次原taskId GET，不重启1800轮正常等待预算，不新增生成、retry、核对写请求、Canvas admission或保存。每个节点单独计数；请求与等待共用调用方AbortSignal，取消或卸载后停止，不应用迟到结果。终态、未知付费结果、素材发布和画布投影仍由原生命周期处理。

状态GET保留非JSON错误页的HTTP状态；401/403/404/409/429、200坏JSON或缺基础摘要字段以及程序处理错误不自动重查。单任务基础摘要至少包含合法id/state/kind、canvasId/nodeId、attempt、时间及prompt字段；归属、输入与模型身份仍由既有调用方校验。写请求解析不受此项改动影响。

本轮本地候选显式替代四类节点刷新恢复的首次直读规则：只有这四个精确taskId读取启用同样的1秒、2秒有限重查，成功后继续完整身份核对。持续错误保持原任务并提供检查入口；工作流直接`waitForGenerationTask`、提交/取消前读取、按幂等键找回和任务列表不默认启用这一增量。部署与验证状态仍由当前任务拥有。

### 2.2 失败节点新一轮生成与自动补偿

本轮本地候选把“核对原请求”和“用户新一轮生成”分开：旧`retry`终态保护不放宽。新准入在同一事务检查该owner/canvas/node/kind的全部任务和attempt；换提示词、模型、意图ID或从工作流切到单节点，均不能绕过尚未确定的付费结果、冲突身份或待恢复结果。明确提交前失败、已核实未受理未扣费、精确退款终态或最终失败且扣费已结算，才可能允许新的手动意图，仍须通过现行输入、模型、凭据、容量、Canvas修订与工作流锁检查。

失败工作流中的目标节点通过`replacesTaskId`关联旧失败任务，在原子准入中绑定新任务。该关联不能由页面报错代替服务端核对；旧run/task/attempt保持终态，其他成功结果和未运行下游保持不变。新结果走现有单节点发布与投影。新一轮可能再次收费，UI需在操作前说明。

视频新提交使用当前输入，原任务恢复仍使用其冻结绑定。Canvas刷新移除同一素材的已确认元数据缓存，不属于用户修改输入：准备阶段自动重读该asset的服务端信息，再执行完整输入/模型校验。真实素材、来源文字、连线、提示词、参数或模型合同变化仍停止当前提交；仅缓存缺失或修订号变化不应要求用户重复点击。此规则不允许跳过共享事务围栏或服务端准入，也不伪造素材就绪。 来源文字的编辑意图在等待画布写入时也须被新提交识别；不能因图快照尚未更新而使用编辑前的正文。

自动恢复仍优先：短暂查询、找回原请求、下载/保存及投影沿既有链继续。原先支持精确退款判断的现代单节点media-generate路径，允许同一用户意图最多一次自动补偿；使用新子任务并在同事务持久记录关联和预算，旧终态不复活，子任务退款、重启或并发不刷新预算。只有本候选明确登记的用户意图可进入该补偿，不补跑部署前的历史失败任务，也不复活失败工作流。客户端只能跟随服务端核验绑定的补偿关联，继续校验完整输入/模型身份。父任务已记录精确退款、进程在子任务准入前退出时，启动工作器会检查本候选登记的待补偿意图；全局生成暂停时不启动补偿，重启不会重置预算。子任务已成功但投影仍待保存时，页面继续读取原子任务状态，不能再次生成。

平台返回余额字样、未知错误或缺少taskId，不等于未受理、未扣费；当前公开示例只支持受限原因提示，不启用无依据的未扣费分类。已扣费终态的精确证据应用是内部受保护边界，没有接受客户端证明的HTTP入口，也没有由通用错误关键词自动调用的路径。真实旧任务须另有可核验的原请求证据，不能用本地假响应解锁。

### 2.3 长期异常的维护收尾（第4版本地合同）

本节约束第4版长期异常维护收尾行为；当前实施、部署与验收状态只由[当前状态](UNBOUNDRY_CURRENT_STATE.md)拥有。原设计、风险与撤销合同保留在方案第9节，代码及本地验证证据见[恢复方案第10节](VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。它补充2.1/2.2及方案3E的预算耗尽后处理，不替代原自动恢复、终态证据、单节点准入或一次补偿预算。

- 短暂故障仍优先自动处理。长期处理记录附属于原task/attempt，维护排队、认领和关闭都不构成平台终态或退款证据，不因此取消正常工作流、重发生成、清空绑定或释放未知保护。
- 统一从原attempt开始时间及冻结的执行合同计算平台窗口：沿用现有合法deadline（上限24小时），无声明时视频75分钟、其余15分钟；不是从最后刷新/认领计时。超过该平台窗口的未决异常进入维护待办，原可恢复路径仍保留既有总窗口（平台窗口再加24小时），不因入队提前停止。已确认不支持自动查回、证据矛盾或publication隔离时立即登记待办。这里只确定系统升级处理的时间，不承诺人工响应或平台出结果时限。
- 无taskId的匹配也须有持久退避与截止：首次按现有扫描机会查询，之后30秒倍增至15分钟上限；一次扫描只使用到期检查点，原身份成功/失败新证据才改变结论。它不新增提交次数；无记录、多条匹配或网络失败不解锁。安全窗口用尽后停止无效自动查询，保持可见的待处理记录，新的原请求证据仍可进入受保护的恢复通道。分页轮转覆盖全部合格任务，不让固定前200条长期占满扫描。
- 维护只允许读取原任务、认领、记录明确的跟进状态及触发受限原请求查询。精确证据的应用由内部命令核验身份、合同、全账本、结果/publication及并发版本；不提供让普通用户或管理员凭勾选“已失败/已退款”就放开新生成的HTTP入口。查不到与已等待很久都不构成未受理证明。
- 找到原结果就继续既有发布/投影；需要从本地`OPERATOR_INCIDENT`或结果未知错误恢复时，只允许精确原attempt的受保护恢复，禁止走通用retry或增加Provider POST。原Provider真实终态、历史失败run及已取消的用户意图不复活。有可靠的新终态证据后，仍经2.2准入由用户决定是否重新生成当前节点；维护结算自身不付费、不自动补跑历史或下游。

上述受保护例外仅针对本地事故task的状态转换，精确前置条件见方案9.4；普通失败task或Provider真实终态不能走此例外，历史failed工作流run始终不恢复为running。
- 找回结果但节点已删除、输入已变或绑定失效时，保存到原owner可见的原任务结果中并明确提示，没有用户应用动作不覆盖当前节点。普通用户的技术排查步骤保持为零；确需充值、改输入或选择新一轮生成时才给出具体动作。上游始终不给可靠证据的任务可以保持未解决，不能为了显示完成伪造结算。
- 处理状态与最终通知从服务端持久事实导出。入队写入成功只表示待处理，管理员明确认领才表示已接手；客户端不能自行宣布维护已接手。站内任务入口保存未读进展，关闭页面后再打开可恢复；不宣称已有邮件、短信或站外推送。UI语义归[UI合同5.9](UNBOUNDRY_UI_DESIGN_SYSTEM.md#59-provider-错误提示)。

### 2.4 已失败工作流的后继执行（保存冲突修复合同）

本节与3.1约束保存冲突及恢复行为；实施、部署和用户验收结论由[当前状态](UNBOUNDRY_CURRENT_STATE.md)与[当前任务](../TASKS.md)拥有，不能从合同文字推断部署状态。

原失败run和其node历史状态保持不变。后续节点尚未准入，且所有必需上游已经成功或经窄域收据找回时，提供一个“继续未完成节点”动作；该动作创建持久关联的子run，只准入仍未开始的节点。原成功/找回结果作为冻结外部输入，不能重跑或改写上游任务。父run只允许一个后继，重复点击、跨标签、请求超时和重启均查询同一持久关联。仍使用原DAG/plan版本、完整owner/graph/input/model校验、锁、容量、取消和未知计费保护；有新输入或未决上游时明确说明条件，不擅自复活历史任务。原结果采用不产生新Provider POST；后继的新生成可能收费，操作前需说明。后继冻结素材包含字节数、哈希、类型与完整存储身份；重复续跑不把已经变化的素材重新冻结为原输入。每个后继节点准入时在既有事务提交前复核，普通新工作流保留原媒体准入行为。

## 3. 保存成功与画布显示的边界

媒体对象写入和数据库事务不是一个跨系统原子事务。staging/publication保存中间证据，持久恢复链负责后续发布，不能把原流程简写成“先直接落媒体目录，再一次性全部成功”。

`commitGenerationMediaResult`校验task/owner/kind/attempt和Provider attempt身份，在事务中完成媒体发布登记、任务成功、attempt完成及事件，并调用单节点Canvas投影。**Canvas投影使用savepoint和独立状态**；可隔离的投影失败保留已保存结果，再尝试同一结果的同步，不重新发起Provider生成。事务本身或savepoint恢复失败仍会抛错，不承诺所有故障都能自动恢复。

workflow节点结果也分别记录业务state与projection_state；`retryFailedWorkflowProjections`只处理已成功但投影失败的节点。task成功、workflow节点成功、Canvas投影完成和用户看到内容是不同证据，不能互相替代。

结果与Canvas owner/node/task及输入指纹必须精确对应。旧客户端缓存只能帮助恢复交互，不能覆盖服务端任务结果或为未知计费结果重新生成。`accepted/response-received/outcome-unknown`、有无远端任务ID以及publication证据决定核对路径；具体Provider的恢复能力不可类推。

### 3.1 保存所有权、输出编号与历史结果采用

- 同一task/attempt的流写入、发布、结算和补偿共用完整owner/kind/runtime/fence/token保存所有权，并纳入既有active runtime的退出等待。后台扫描不接管仍在写入的任务；租约时间超出不能证明旧写入已停止。不同任务独立进行，嵌套调用显式复用令牌。
- schema44的生成结果使用稳定output slot/count，单次支持1/2/4等合法输出数；同字节的不同输出仍占各自编号。同编号重放复用既有reserved/staged/external-ready/published登记，最终结算核对完整0…count−1及Provider冻结身份。禁止按published条数切掉平台结果，禁止按创建时间或哈希猜测编号。
- 下载未完整落盘时，只有精确原任务仍可恢复、活动保存令牌和输出编号匹配、publication为compensating且字节0/完整哈希NULL、失败资产同身份无有效字节且无删除意图，才可收口该本地片段。OSS对象HEAD缺失后还须成功核对原存储桶；有对象、缺桶、权限不足或网络未知均保留证据，不按键删除远端对象。通过核验后沿原task/attempt重新读取原结果，不增加Provider POST；已取消、结果未知、无远端任务号和历史无编号记录不适用此窄分支。
- 原请求可恢复的查询/下载/保存/投影异常保持既有自动恢复和预算。缺失的staging仅能从原请求重新取得并按原哈希核对；补保存不得再次发起生成。真实终态、取消、隔离、未知计费和同步结果已丢失的事实不能伪装为正在恢复。
- 旧schema无法证明编号的结果保留null；新增保存/结算不得静默跳过未核实null证据。已成功的旧多结果只读展示保留原内容和顺序，这不是给旧条目猜测编号或授权重结算。当前任务选中的单一A/B/C事故仅能经完整账本、对象证据、原错误链和不可变收据校验后采用一个canonical结果；其他同源证据保留为alias，不删除或充当第二个输出。节点已变化时保留原结果供查看，不覆盖用户编辑。 当绑定仍有效但Canvas事务发生异常时，整个本次采用回滚，不能仅凭素材/回执登记宣称画布已恢复；重复采用通过既有幂等Canvas命令核对实际投影，已经应用的结果不重复结算。采用路径保留原任务已记录的费用与用量，不能被publication中的空值覆盖；普通新生成仍按原结算链写入。
- schema44的撤销是兼容schema44的只读保全包与新包之间切换，保留当前数据；禁止降到不能读取schema44的旧包或用旧备份覆盖新数据。实际演练状态由当前任务拥有。

## 4. 当前显示和尺寸合同

新图片/视频auto节点在可信素材接管或结果投影时按素材比例适配。旧节点没有尺寸模式时保留旧大小；manual节点保留用户尺寸，主动适配通过正式命令并可撤销。加载、播放、metadata、刷新不应触发布局写入。视频节点内部约束播放器可用高度并使用contain，避免竖屏下半截被裁切。

模板节点位置不自动重排，竖屏高度增加后的重叠由用户整理；选中模板整体使用临时层级置前，不重写持久zIndex。该优先性由selected触发；仅新插入模板、设置primaryId不等于选中或自动置前。完整规则见 [UI合同](UNBOUNDRY_UI_DESIGN_SYSTEM.md)，已验收范围按总矩阵对应条目查证。

前端会按节点消费服务端结果；这说明代码不要求等待整组结束后才显示，不承诺零延迟。历史缩略图和首次画布的性能状态见 [当前状态的未决事项](UNBOUNDRY_CURRENT_STATE.md#未决事项)，测量方法与适用范围见 [性能证据7.2](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#72-性能结论与范围)。本地目标通过不能推导为正式站性能基准或竞品对标通过。

Canvas写入口受命令/写者清单约束，DATA-005仍是跨标签最后保存者胜并同步、同标签拒绝迟到旧请求，不得误写成跨标签全局CAS。

## 5. 运维与验收边界

线上HTTPS、systemd和服务端workflow已有实现；实际版本、schema及运行入口以CURRENT_STATE链接的发布回执为准。手动加密备份、恢复演练、云端核验和每日自动备份是不同验收项，其现状由CURRENT_STATE维护；不能用一次手动备份通过代替自动作业验收。

CI配置见 [.github/workflows/quality-gates.yml](../.github/workflows/quality-gates.yml)，包含类型、架构、生产build、high阈值依赖审计、安全预检、隔离HTTP/fake Provider工作流与文档检查及源码覆盖。配置了检查不等于某次运行通过；实际run与范围由相应任务和发布回执记录，不扩大为所有测试套件、真实Provider或灾备通过。

维护后更新通知、依赖修补、性能和暂停项的现状统一见CURRENT_STATE；本文不保留另一份会落后的待办列表。具体操作看 [发布Runbook](../RELEASE_RUNBOOK.md) 与 [备份运维](../ops/production/README.md)。专项加固方案只有被当前任务明确选中才约束该项工作，尚未实施的方案不能写成现有行为；本文不构成运行旧脚本、发布或付费生成授权。
