# 媒体保存与自动恢复冲突修复方案

文档角色：`TASK_PLAN`。任务`MEDIA-PUBLICATION-RACE-20260910`；修订3，2026-09-10。方案层独立复审通过，范围与未执行项见第10节。用户已在独立方案复审后回复“可以”，当时授权本地实现、回归、撤销演练与独立代码复审；该阶段不操作真实任务、不上线。后续发布授权与当前准备状态见第12节。

精确事故记录由[当前任务](../TASKS.md)拥有；生产身份和既有发布证据由[当前状态](UNBOUNDRY_CURRENT_STATE.md)及其回执拥有。本方案基于源码HEAD `3eae6840ec3ac825e7e3908fc7b8f66692228db2`。原两份诊断文档改动保留，尚未同步GitHub/服务器。

## 1. 用户会得到什么

1. 正常生成遇到暂时保存故障时，系统继续保存同一份结果，恢复后自动回到节点，正在运行的整组自动继续；不要求用户反复点击检查或重试。
2. 同一份输出的保存与后台恢复只认同一个持久登记，不因竞争产生两条输出再误判模型格式错误。一次正常生成确实要求多张相同图片时，仍保留这些合法输出。
3. 本次已经失败的历史任务，先核对并接回原结果；其他成功内容、位置、连线不变。原失败工作流记录保留。原图恢复后，用户通过一次“继续未完成节点”操作执行尚未启动的下游，不必逐个节点补跑。该按钮是本方案新增范围，当前产品尚无此接口；后续生成按模型正常计费，找回已存原图不提交模型生成。
4. 过程、失败、保存完成使用既有统一提示；已保存结果不能仍显示成模型生成失败。

“彻底”的验收范围是本次保存/恢复竞态及其直接衍生的重复登记、错误终态、结果回填和续做问题。外部平台停服、真实无结果、计费不明等仍按现有保护处理；方案审查不能代替修复后测试，不能承诺所有未来故障或零回归。

## 2. 已有证据和必须先复现的链路

生产已查到：文字成功；图片同一task/attempt下先发生`MEDIA_RECOVERY_EVIDENCE_MISSING`，后有两条相同字节数/SHA的published/ready记录；任务最终`PROVIDER_RESULT_FORMAT`，run failed、9个下游blocked且未准入。该task只有一条Provider attempt登记。云端字节尚未重新GET验证，原结果尚未接回画布。

| 源码入口 | 已发现的问题或约束 |
| --- | --- |
| `server/generationTasks.ts:873`、`:929` | 每30秒后台扫描；正常执行已有launched task防重，publication扫描未统一进入同一task的执行排他边界 |
| `server/mediaLifecycle.ts:1198`、`:1320` | 扫描包含reserved；准备恢复把reserved直接视为失败，不能区分活跃保存与进程遗留 |
| `server/generationResultCommit.ts:995`、`:1083` | 恢复失败会将任务写成失败并触发补偿；工作流据此进入终态 |
| `server/generationTasks.ts:4520` | 按published条目数切剩余输出；计数超过平台输出数量即报PROVIDER_RESULT_FORMAT，不能识别本地重复登记 |
| `server/workflowRunService.ts:1285`、`:1406` | failed run不继续处理；task真失败使工作流失败，此保护不能直接删除 |
| `server/generationResultCommit.ts:42`、`server/generationRecoveryOriginalCommands.ts:35` | 当前历史恢复白名单并不通用接受本次错误；不能只在前端清错，也不能笼统放开所有PROVIDER_RESULT_FORMAT |

上述代码与时间线强烈吻合，尚无本轮受控红测；第一道施工门是在旧代码稳定重现“正常保存暂停→恢复扫描→错误失败→重复登记→下游停止”，同时设无扫描对照。若不能复现或发现另一原因，先修正事实和方案，不直接按推测改代码。

## 3. 技术路线：统一原任务结果的保存所有权

### 3.1 运行中与重启后的所有权

- 复用已有runtime active-role独占租约和registered execution/drain机制，增加同一owner/task/executionAttempt的统一保存入口。正常保存、保存重试、定时扫描、启动恢复、维护原结果应用全部经此入口；列清调用点和绕行检查。
- task之间仍可并行，禁止一把全局长锁阻塞所有生成。一个task内只有一个保存所有者；扫描发现正在保存的task只记录待处理，不能判失败、清理、重新下载或重新占位。任务门按完整身份且只覆盖媒体结果阶段，不能让Provider长轮询永久阻止有待发布字节的恢复。
- 外部入口获取一次所有权并把显式token传给内部阶段；内部阶段不得再次等待同一门。扫描使用非阻塞尝试，拿不到立即让出；正常重试在同一所有者内先协调现有publication，不能等待一个必须由扫描才能释放的状态。不同task不能相互等待持有的publication门，避免为修竞争引入死锁。
- 定时扫描本身禁止重入；所有异步工作登记到runtime drain，并在退出、异常、取消时释放登记。继任进程必须先获得同一数据目录的独占active lease；旧进程失权或进入退出后不能发起新对象写入和数据库提交。每次await后、发布提交和补偿前重新检查任务/attempt/取消/删除及publication状态。
- schema44新增`generation_result_save_leases`：主键(task_id, execution_attempt)、owner/kind、runtime_instance_id、单调fence_epoch、随机holder_token、phase、heartbeat_at/lease_until、released_at。首次领取在BEGIN IMMEDIATE核对任务并生成epoch/token；续约/释放WHERE必须匹配原runtime/epoch/token，失败立刻失权。数据来自运行时内部，HTTP调用方不能提交租约身份。
- 正常、启动、定时、维护入口统一以此持久CAS租约为裁决；task门只做同进程单飞优化。继任领取须同时持有该DATA的active lease，并证明前holder已正常释放或原runtime已退出；时间到期只触发中断/核查，不直接抢占仍活着的I/O。现owner的内部调用显式传递token，不嵌套领锁；调度拿不到立即让出。每次publication状态改变、槽创建/采用/结算、文件交接或对象写入/补偿均校验token，迟到者只能保留/隔离自己精确拥有的字节。
- task租约在保存阶段的所有I/O和补偿实际结束后finally释放；已放弃却未能确认远端写入结果时，保留该槽外部状态不明证据交给原对象核验。不得只release内存Set就让另一个writer重复PUT。崩溃后继任先读原publication，external-ready/published优先提交，不跳过未决对象直接另存。
- 不采用“等30秒就当作写完”的判断，不仅依赖内存Map。进程锁保证同一DATA只有一个活动运行时；持久publication与下节输出槽登记负责崩溃恢复。正常关停须等实际I/O结算；无法证实旧工作器结束时不能把租约超时当作接管许可。

### 3.2 同一输出一次登记

采用**schema44持久输出槽**，不把JSON审计事件当作输出唯一性约束。`media_publication_attempts`新增可空的`output_slot`、`output_set_count`，新生成记录以完整任务身份和槽号唯一绑定；旧记录按下述精确迁移规则保留。事件只记版本化审计事实，不拥有另一份独立映射真相。

- 数据库约束：新生成槽`0..3`，集合数量`1..4`且slot<count；上传来源槽和数量均null；同task/attempt的owner、kind、集合数必须一致且与冻结任务/模型合同一致。合法旧未映射记录允许字段null，但新写入入口不得借null绕过约束。
- 行内范围/成对null使用CHECK；新generation INSERT还要有数据库触发器拒绝空槽，避免遗漏入口写出新legacy行。跨行owner/kind/count/Provider身份不是SQLite CHECK能保证的：在创建/复用/替代/采用的同一BEGIN IMMEDIATE事务里读取该task/attempt全部publication和对应Provider attempt，逐项核验一致性；任一不符零新增、零终态改写、零Provider调用。
- 新增持久唯一索引`(task_id, task_execution_attempt, output_slot)`，限定generation、slot非null且state属于reserved/staged/external-ready/compensating/published。保留现有active_task约束；同task按槽顺序处理，不为并行输出删除旧保护。跨owner/kind的同task异常拒绝，不能因附加错误owner就另占一槽。
- Generation域发起同一BEGIN IMMEDIATE事务：校验完整身份→按槽查找或创建→调用Media域的事务内reservation命令→写审计事件。抽出`reserveMediaPublicationInTransaction`类型化命令以避免嵌套事务；不允许Media域越权改Generation账本。任何一步失败全事务回滚。
- 同槽已有active/published登记就复用原reservation/asset，不能创建新素材；同槽failed仅在原对象/删除意图已明确结算且无隔离、迟到写所有者时允许建立替代publication，旧记录和替代关联保留。compensating/quarantine不能被替换；不通过调state绕过索引。
- reserve返回显式`created | reused-active | reused-published | blocked`分支，三类storage调用方必须消费该结果：只有created可新建asset/暂存文件；reused-active等待或恢复原publication；reused-published直接幂等commit/replay。数据库唯一冲突在事务内重读返回原槽，不变成随机新asset或让用户再点重试。
- 必须将稳定slot从`saveRelayMediaOutputs`依次传到`assetStorage`、`videoStorage`、`audioStorage`及publication/commit。集合提交改为核验槽集合恰好等于`0..count-1`，不再用published.length切片或created_at猜顺序。每个逻辑槽只结算一次，合法1/2/4输出均保留。
- 索引是首次可信输出集合的槽位，绑定原Provider任务和冻结结果数；有稳定平台输出ID则绑定并持久保存非敏感身份摘要。后续原请求的输出集合/顺序发生变化且无法核对时，保留原槽并保持待核对；不能只凭数量或相同SHA猜槽位。签名URL刷新不代表新输出。所需集合身份摘要使用有界version1审计事件，不存密钥/签名URL/图片正文；事件缺失或矛盾禁止靠计数补猜。
- 每次重试先读取槽：reserved继续原占位暂存；staged继续原字节发布；external-ready完成数据库提交；published复用结果。同一槽不同bytes保留已有结果并登记本地冲突，不触发生成POST；不同slot的相同bytes允许保留，禁止全局按hash去重。
- 字节暂存关闭并完成持久化、大小/hash/type核验后才CAS到staged。每个物理写入token绑定精确publication及所有权；旧token的迟到写入不能覆盖当前文件，使用独占创建/原子交接及每次await后CAS验证。失权后只处理该token拥有的临时文件，禁止删除/覆盖其他publication对象。无法安全清理则登记隔离而不丢弃证据。
- 旧schema43迁移：全账本证明同task/attempt只有一个合法逻辑输出、冻结数明确为1、无其他已受理/冲突publication且身份齐全时才映射slot0；多条、重复published、缺身份/顺序或已隔离者保持null待核验。迁移不根据SHA自动合并、不调用Provider/OSS、不变任务终态、不删除任何素材。若不能完成该证明，保持未映射并交给原结果恢复分支；新写入不能越过未映射的旧pending结果。
- legacy identity fence必须覆盖同task/attempt所有未映射的reserved/staged/external-ready/compensating/**published**记录，创建新槽前同事务检查；有任一行就禁止新publication和新Provider提交。只有第4节窄域核验命令可以明确采用canonical并登记精确重复别名；普通扫描不能把null published视为“没有结果”。已核验别名的排除必须绑定完整采用回执/账本摘要，由同一命令和所有集合读取/提交入口一致验证，不按hash临时忽略。
- `failed`替代槽、旧null槽采用和canonical选择必须由同一受保护命令拥有，不能出现读取走新索引、旧commit仍按全部published条目结算的双轨逻辑。针对本文事故按第4节唯一证据选择canonical，将重复记录保留为未映射历史别名；冲突事实不得伪装成合法第二个slot。
- 新增字段的DDL/CHECK、唯一索引、兼容读取及所有新写入入口必须一起验证；若出现其他writer可写null绕过、跨槽计数不一致或不能保持旧数据，列为P1停止发布，而不是放宽约束。

### 3.3 自动恢复与终态

| 实际证据 | 处理 |
| --- | --- |
| 当前保存工作器仍拥有任务，reserved尚在写入 | 等待该工作器，保留正常过程状态 |
| 原工作器已退出，存在有效staging/external-ready | 由新所有者继续原字节；持久检查点和既有恢复总窗口继续，刷新/重启不重置预算 |
| 原工作器已退出、暂存缺失，但原Provider结果可查回 | 查原请求并写回同一槽；不做新的生成POST |
| 对象写入响应丢失 | 走现有OSS精确身份核验及安全采用；缺证据/哈希不符保留隔离，禁止覆盖相同key或删除不属于本次写入的对象 |
| compensating或OSS_IDENTITY_QUARANTINED | compensating仅继续该publication的精确清理，完成前保留槽、不换绑，不因扫描再次写普通任务失败；quarantine保留隔离证据，不自动清理/换绑。只有明确清理完成且无迟到所有者才允许按原逻辑槽恢复保存 |
| 同步模型结果只在内存且字节已丢失，无法找回 | 沿用现有受保护终态/维护路径；不承诺自动找回或偷偷再次付费 |
| 真正平台终态失败、输入无效、取消/删除、身份变化 | 沿用各自现行规则，不用“自动恢复”吞掉错误或复活旧意图 |

可恢复的本地保存异常保持running/recovering及明确保存原因，沿用已有检查点/退避/截止；不会先写failed再被下一轮扫描复活。只有槽集合完整、每项素材ready及完整账本核验后才提交task success，成本/attempt/事件只结算一次。输出合法性在Provider适配边界判断，本地重复登记应有本地错误分类，不借用PROVIDER_RESULT_FORMAT。

正在运行的工作流只等待任务恢复；成功后按原调度继续。保留`OUTCOME_UNKNOWN_BILLING_RISK`无远端ID、真实失败、用户取消等原终态策略；禁止笼统把所有failed run恢复成running。

## 4. 本次历史事故的原结果采用

这是与代码修复独立的真实数据操作，当前未授权执行，也未证明云对象可读。

1. 先实现内部dry-run核验器，在合成事故副本测试；正式操作前按[发布手册](../RELEASE_RUNBOOK.md)做本次一致备份、独立恢复验证及具体操作单。旧未知视频任务及其他用户数据不在操作范围。
2. 固定本次task/attempt、run/node、owner、输入指纹、Provider身份和冻结结果数。原请求查询只允许GET且需相应授权；既有published/ready素材须核对对象字节/大小/hash、存储profile/owner、可读性与无quarantine/删除意图。仅相同SHA或错误文案不能证明合法恢复。
3. 新增schema44表`generation_result_adoptions`，保存版本化receipt及原账本摘要，唯一键(owner_id, task_id, execution_attempt, incident_digest)；receipt绑定本次task/run/node/attempt、Provider task/profile/model/credential、原错误事件摘要、冻结输出数、全部publication ID及每个对象的size/hash/profile、原attempt/计费状态、无新Provider请求证据和本次核验时间。缺少任何一项、出现真实Provider格式失败/收费结算冲突或新意图均拒绝；不是给PROVIDER_RESULT_FORMAT加通用白名单。
4. 对本次预期1个输出的B/C双记录，在同一受保护事务中校验receipt与完整账本CAS→将唯一canonical记录提升为slot0/count1→将另一记录保持null并在receipt明确列为同源别名→经更新后的原output-set命令结算→提交采用回执。所有普通集合读取/提交只按非null槽读canonical；未映射null遇到缺失/不匹配的采用receipt必须阻断。对已认证别名只做保留，不删除、不移动、不重新上传、不全库去重。事件只是辅助审计，canonical真相为槽字段与持久采用receipt，不在内存临时选一条绕过集合检查。
5. 新增窄域“本地保存事故原结果采用”命令。允许本次已证明的本地错误链进入原结果恢复，不按错误码一刀切开放所有格式错误/失败任务。命令需核验完整账本摘要、版本、现有绑定和取消状态；原失败事件保留，只追加采用事实，不捏造Provider失败、退款或新attempt。
6. 原输入、来源和绑定仍一致且无新任务时，以原结果通过既有Canvas事务命令投影；输入已变、节点已删除或已有新结果时只保留原任务素材并说明变化，不覆盖用户工作。跨标签最后保存者胜/同标签迟到保护继续执行。
7. 重复执行、超时响应重发、进程重启均返回同一采用回执，不增加结果、费用或生成请求。正式执行前后对比全部非目标成功节点内容/几何/连线及任务/attempt数量。结果保存记录和实际画布显示分别验收。

## 5. 让已经失败的这组继续工作

此节是新增的窄域后继工作流能力，与第3节预防新故障分别测试。避免恢复原图后仍要求用户逐个下游操作。

- 原failed run和failed/blocked节点的历史保持不变。恢复原图并确认可用后，提供一个“继续未完成节点”的动作；服务端计算可继续的节点清单，明确已完成节点会保留、后续正常生成可能收费。维护找回结果本身不能自动触发这次新付费意图。
- 通过受权限和幂等保护的新命令创建一个后继run，绑定父run、当前图版本、已恢复原结果和用户此次意图。复用既有冻结计划/调度/准入/容量与锁，不另建一套executor；从旧run中只选择未准入的blocked下游。已成功或已恢复上游转为冻结external input，绝不再次提交这些上游。
- schema44新增`workflow_run_continuations`，唯一(owner_id, parent_run_id)，并对child_run_id唯一；记录preview_digest、intent_id、graph_revision、所选未准入节点ID、冻结external input的原task/asset/text hash/来源、canonical adoption receipt ID。该窄域版本只允许一个父run创建一个后继run；之后再次继续须以失败的子run为新的父对象，不能向同一父run创建不同意图来绕过防重。
- BEGIN IMMEDIATE中重读父run/所有节点与完整任务账本、图版本和external来源摘要→检查现有父子记录（存在且preview相同就返回原子run；不同则明确冲突）→创建冻结子plan和run→写入唯一关联→获取原有workflowRunLocks/容量保留→一起提交，提交后才启动worker。无publication/task/single-node竞争窗口；双击/两标签/请求响应丢失/重启必须返回同一child。HTTP入口只接受父run与受控preview意图，不能信任客户端任意传入生成节点清单。
- 子plan沿用version1形状：仅未准入下游出现在nodes和executableNodeIds，二者顺序及集合完全相等；成功/恢复上游只作为带asset或text、hash和来源核验的externalNodes，去掉已转external的动态dependencies并保留其引用edges。父子关系由专表拥有，不往旧解析器严格结构随意塞字段。当前完整图的语义摘要与受控子图摘要分别记录并在执行前按其职责校验，不把全组fingerprint误当子计划identity。
- 当前图的节点/边/提示词/模型合同必须与原范围及用户预览一致。冻结external input还须通过现有owner、asset ready、text内容和完整来源身份核验；任何输入变更都重新显示受影响范围，不静默改为全组重生成。
- 与单节点补跑、普通整组执行、取消/删除竞争时由同一准入事务/图锁裁决。未知计费、真正失败且未结算、未保存结果不能进入后继任务。旧run不复活，不自动重跑先前确实失败但已有Provider attempt的节点。
- 本次期望：原文字和原图片0次新生成，其余9个节点按依赖推进且每个只准入一次。旧记录其他shape不是默认适用范围，先返回具体不可继续原因。

合同衔接：此节补充生成合同2.2的用户新意图，不替代2.3“历史failed run不复活”。获本地施工授权后，与实现一起在生成合同2.2/3、UI合同5.9登记后继run与原结果采用规则；不把草案当成已上线产品合同。现有普通单节点补跑的其他成功/未运行节点保持规则不变。

## 6. 对正常功能的影响与UI

直接影响媒体生成保存、原任务恢复、结果集合结算及工作流状态；文字结果保存算法不主动改动，但文字→图片→视频的依赖链必须回归。共享Media调用还服务上传、图片编辑、删除补偿，这些来源必须明确区分；新增输出槽只用于generation来源，不改变用户上传的既有adoption/清理语义。

| 必须保持的功能 | 约束及检查 |
| --- | --- |
| 自动恢复 | 网络短断、状态查询1s/2s、原结果找回、保存重试、重启接续保持；一次意图自动退款补偿预算不重置 |
| 单节点与整组 | 单节点补跑不重生成成功邻居；正常组自动推进；锁/取消/真失败/未知计费仍阻止不安全请求 |
| 图片/视频/音频 | 原Provider参数、模型、引用及格式处理保留；媒体元数据、尺寸/比例、播放控件不改变 |
| 文字、模板、画布 | 文字内容、模板坐标、白框、连线、拖动加号菜单、浏览全部层级、保存刷新/跨标签规则不变 |
| 上传/编辑/删除 | 原upload来源、编辑引用、删除意图、OSS精确对象补偿和账户归属保留 |
| 错误UI | 复用ProviderErrorNotice及现有组状态显示；四节点/整组同一后端状态来源；无需新增一套横幅样式 |

状态文案：保存工作实际进行时显示中性“结果已生成，正在保存”；有实际恢复任务/下一次持久检查点时显示“正在恢复保存，无需重复生成”；保存并投影后移除旧错误。暂停、无法判定、超期均按真实状态提示，不用动画假装后台持续工作。根因详情保留可访问入口；同任务只保留一个主要提示，避免节点红条和全局toast反复叠加。顶栏“已保存到云端”仍只表示画布保存。

复用UI合同5.9字号/色彩/尺寸、6.2—6.6白框/比例/菜单规范；新增按钮复用现有组件，验收窄节点、缩放、长中文、键盘与焦点，不调整持久节点几何来容纳提示。

## 7. 验证矩阵与通过标准

所有工程业务测试走`scripts/run-safe-tests.mjs`、专用Node22.23.1/npm10.9.8、临时合成数据、假Provider/假OSS和动态loopback。无真实付费、无4173、无真实DATA或保护JSON访问。此表是待执行计划，不是通过记录。

| 编号 | 必测场景 | 通过标准 |
| --- | --- | --- |
| R01 | 旧代码保存停在reserved/staged/外部上传/提交的可控屏障，扫描介入 | 在旧代码稳定得到事故，保留具体错误链；无扫描对照成功 |
| R02 | 同一屏障在修复后释放，定时/启动/正常保存竞争 | 任务不被提前failed；原Provider POST=1，逻辑槽和canonical结果各1，自动回填并推进下游 |
| R03 | 保存超过30秒、多次扫描同时进入、10个任务交错 | 同task排他，不同task仍推进；不靠sleep碰运气，不永久占锁 |
| R04 | 每个publication阶段进程退出/重启/旧worker迟到 | 原staging或原请求恢复，预算不重置、迟到写拒绝、无重复POST/发布/计费 |
| R05 | 图片1/2/4输出，顺序/URL变化，两槽相同bytes | 按槽稳定对应，合法同内容不丢；不明确身份时保护原结果，不猜槽、不新增付费 |
| R06 | OSS PUT成功响应丢失、hash不符、profile变更、quarantine | 精确safe-adopt或保留隔离；不覆盖/误删对象、不新建Provider请求 |
| R07 | 断网/短断查询、保存失败后恢复、真正终态、同步字节丢失 | 原自动恢复及终态保护符合合同；不会频繁要求用户检查，不把真失败藏成等待 |
| R08 | 取消/删除/改输入/换模型/跨标签保存与结果提交同时发生 | 用户最后有效意图优先，不覆盖新结果，原素材证据保留，旧attempt不复活 |
| R09 | 正常text/image/video/audio单节点/混合组，V3/V4补跑/预算 | 成功内容/结果数/成本登记不变；九个成功节点保护、单节点互斥、退款预算及未知任务围栏保持 |
| R10 | 合成本次A/B/C事故：采用→刷新→重复采用→节点已变 | 原结果一次接回或明确保留到任务；双素材不删除、不新增Provider POST；非目标原样 |
| R11 | 后继run预览、点击/双击/两标签/响应丢失/重启 | 只产生一个后继run，仅未准入节点生成，原文字/原图POST=0，原failed run不变 |
| R12 | 后继run输入改变、单节点竞争、取消、容量不足、未知结果 | 原准入检查生效；未授权范围零请求，不把任意失败节点加入补跑 |
| R13 | 四节点统一提示、白框、菜单层级、拖线、比例、刷新、模板坐标 | 自动恢复过程中不出现假失败；结果后旧提示消失，已验收UI与内容均保持 |
| R14 | 上传/图片编辑/删除与生成发布并行 | upload不进入生成槽；删除意图/精确对象补偿和归属规则保持 |
| R15 | schema43→44、槽/审计/后继run的backup/verify/fresh restore/兼容包读取 | 43旧null published/active阻断新槽；44新槽/全账本/素材/未知保护保留；跨行身份/count冲突拒绝；重复reserve不新建asset；compensating/quarantine不换绑；manifest/表结构/索引一致 |
| R16 | 新应用→独立只读保全包→新应用的本地隔离撤销 | 数据与草稿不回退；schema44兼容回退包不发生成/恢复写；再切新包后正常恢复开启且持久任务正确接续 |

实际测试入口按以下责任映射，实施时登记最终选择和结果：

| 验证范围 | 现有spec |
| --- | --- |
| publication/真实HTTP链路 | `m88-media-publication`、`m104-inc-gen-026-reliability`；在其中加入R01—R06受控屏障和槽约束测试 |
| V3单节点补跑/提示 | `m104-inc-gen-026-reliability`已有V3单视频补跑、`m41-generation-retry-ui`既有V3状态UI |
| V4/原结果恢复/预算与幂等 | `m5-generation-recovery-original-commands`、`m5-generation-recovery-cases`、`m40-generation-recovery-worker`、`m40-generation-recovery-scheduler`、`m40-generation-idempotency-recovery`、`m41-generation-recovery-cases-ui` |
| 正常工作流/Canvas保存与交互 | `m103-server-authoritative-workflow`、`m104-canvas-command-gateway`、`m85-canvas-persistence-server`、`m86-canvas-load-safety`、`m98-canvas-ui-recovery` |
| runtime接管/迁移/媒体/备份/回退 | `m93-runtime-role`、`m91-schema-migration`、`m87-media-integrity`、`m10-backup`、`m92-version-compatibility`、`m95-release-switch`、`m96-release-ops` |

以上名称均指`tests/<名称>.spec.ts`。先红测/最小修复子集，再跑全部直接影响的相关spec；具体新增测试名、最终命令、发现/执行/通过/跳过数量与失败原因须实施时记账。旧schema43专用回退mjs脚本继续作为历史证据，不能直接当schema44回退门使用。不把现有旧PASS继承为新行为通过。


工程通过门：红绿复现；上述适用矩阵全部通过；类型/架构/构建和必要writer manifest检查；独立代码审查无未解决P0/P1/P2；本地撤销演练通过；再交用户一次清楚的本地验收。失败只重跑最小相关集，修改共享合同后再扩大对应回归。

## 8. 本地验收给用户看的四项

同一页面左侧步骤、右侧测试画布。全部合成任务和素材，不扣费；每项后台演示完成后辅助页自动重新读取真实画布并定位目标，用户不需要切换标签。

1. **保存恢复**：点“开始保存恢复演示”。“保存恢复演示”节点出现白底红方块视频，可以播放，不停在红色失败。工程层实际在视频 body 写入窗口执行恢复扫描，检查任务仍 running、发布记录仍 reserved，随后真实发布、投影并 GET 校验视频字节；视频用于共用发布链的可视化演示，图片保存回归另由 m88/m108 覆盖。
2. **找回已有图片**：点“找回已有图片”。空框出现蓝绿底白横条图片；点“刷新右侧画布”后仍在，没有重复结果。后台使用真实采用与幂等回放命令。
3. **只完成后续节点**：点“继续未完成节点”。两个未完成视频自动完成，原三个文字节点和图片不重做；真实临时 Provider 按请求 model 计数，视频 POST=2、图片/未知模型 POST=0，父 failed run 保留，子节点 success/applied。
4. **原有画布操作**：先点“核对原内容是否保留”定位正常图片，再打开“浏览全部”、从右侧加号拖到空白处选择“文本生成”，拖动/缩放画布并刷新。检查白框完整、菜单在输入框上方，新节点与连线和原结果保留。这里检查创建引用节点，不要求点付费生成；正常生成和单节点补跑由前述隔离回归覆盖。

工程状态 done 不等于 USER_PASS。辅助页重读只证明真实结果读回，不冒充前端自动通知端到端证据；自动恢复由第7节对应测试覆盖。用户仅需确认可见结果与交互，不操作工程记录。生产故障、真实数据采用和真实平台生成尚未执行。

## 9. 施工顺序、风险与撤销

施工顺序：A旧版受控复现→B统一所有权/输出槽及自动结算→C历史事故采用→D后继run和统一UI→E新旧回归、完整撤销、独立代码复审→F本地用户验收。每段使用独立可撤销提交范围；当前不commit/push、不改版本。未获后续发布授权不进入线上操作。

| 风险 | 具体应对 |
| --- | --- |
| 跳过活跃写入后真正遗留结果永远没人接手 | 同一进程完整finally/drain登记、继任active lease、持久槽/检查点；测试异常/退出/重启，不以只延迟扫描过门 |
| 只按SHA去重丢掉用户要的两张输出 | 只按完整任务身份+稳定槽去重，hash仅核验；R05必须含两槽同bytes |
| 扩大错误白名单释放未知收费任务 | 采用专门证据命令；原错误、平台task、原attempt和全部账本CAS，拒绝无Provider ID、真正终态/退款冲突 |
| 恢复原图覆盖用户新编辑 | 第4节身份/图版本/输入/绑定核验，失配保留原结果而不覆盖 |
| 后继工作流扩大范围或重复收费 | 独立用户新意图，后继run唯一关联/持久幂等，复用原准入/锁，仅未准入下游；R11/12验证 |
| 改共用Media影响上传/删除/模型 | generation来源范围限定、类型化事务入口、R09/14及独立跨域审查 |
| schema44数据被旧v0.7.17错误处理（P1） | 旧包不得直连schema44；准备可读schema44的保全回退包，R15/16通过才可发布，绝不降级数据库或覆盖CURRENT |

本地撤销：冻结修改前代码身份与合成数据库，逐段撤销代码不删除用户工作；完整新→兼容回退包→新安装包练习使用schema44槽、新事件、待保存结果、原未知请求与草稿数据，验证数据不丢且不重复请求。不得把只运行git diff或关闭所有worker的启动检查写成正常工作流回归。

未来生产必须新增以下发布门，当前尚未执行：

1. **迁移门**：明确发布版本和schema43→44授权；在最新合成/经授权副本执行原子迁移、integrity/FK/全账本/媒体关联与计数核验，验证零Provider/OSS调用、零任务终态修改和失败事务原样回滚。schema44仅按本方案增量增加字段、表和约束，不自动清理旧数据。迁移耗时和索引构建需实测，失败不部分启用。
2. **备份门**：升级backup-data、verify-backup、restore-backup及数据库完整性/媒体检查对schema44的合同，仍能验证schema43历史备份；包括新槽/nullable旧记录/重复历史/未知任务的logical SHA。同时更新`server/database.ts`的currentSchemaManifest、结构/索引/触发器/checksum检查（当前2659—2834、2906—2946等对应区域），不可只加迁移SQL。迁移前最新schema43一致备份并fresh restore；迁移后的schema44备份再独立restore。禁止仅扩大schema允许数而遗漏结构/约束验证，不修改既有加密备份。
   - 冻结schema43完整结构合同及历史37—42校验分支；`databaseMatchesSchemaContract`不能用新44字段去验证旧43。特别核对历史schema42分支是否复用当前表合同，避免修改当前schema同时破坏旧备份。
   - `server/backupInspection.ts`、`backupPackage.ts`、`mediaIntegrity.ts`须分别识别当前44和历史43；保全备份contract增加版本分支，不能把原`expectedSchemaVersion:43`机械替换。新的租约/采用/续跑表及索引/触发器也必须加入manifest、logical SHA、完整性和恢复对账。
   - 迁移使用独立`schema43To44Migration.ts`及明确CLI入口，保留旧42→43迁移的版本职责。更新backup-data/report-media-integrity/backup-final-candidate、safe runner、build-release/rehearse-release/admitted-release/validate-release-ops的当前schema门；历史settlement工具保持43专用并明确拒绝44，不全仓机械替换版本号。
   - 迁移前后logical SHA必然不同，不能要求二者相等；记录可解释的DDL/ledger/新增null字段差异和原业务数据保持证明。每份备份与它自己的fresh restore logical SHA必须相等；44保全回退阶段无业务写则对比44进入/离开快照相等，新包恢复执行后的新增合法变化另有任务审计。
   - integrity允许运行中槽集合为合法前缀/待补齐状态；只有task宣告成功才要求完整`0..count-1`。非法间隙/重复/数量/身份冲突要区分活动与终态，不能把正常正在保存的半组结果当损坏。
3. **兼容回退门**：旧v0.7.17不能直接打开schema44运行。本轮准备精确的schema44兼容保全回退包；只提供经测试的浏览/维护能力，禁止生成、后台恢复/维护和历史清理写入，保留槽与未知账本。若无法证明其不会写，就保持维护页且不启动旧应用。兼容包不是完全恢复正常生成的承诺。
   - 兼容包是本轮需新建并核验的独立schema44保全程序，当前并不存在。启动状态机：冻结准入→drain实际Provider/I/O及取得active lease→停止新包→兼容包仅以SQLite mode=ro/query_only打开schema44，提供只读健康/已有结果读取或静态维护页，不运行应用自动迁移/启动恢复/写session/缓存/清理任务；写路由返回维护错误。只修改schema号并禁一个sweep开关不合格。
   - 退出兼容包后，校验CURRENT schema/ledger/槽/采用/续跑/素材与只读前一致，再以精确新包启动，健康及身份验证后解除维护。进程内产生任何写入或Provider请求即R16失败。只读鉴权若不能不写session完成，使用静态维护页，不承诺可登录编辑。
4. **真实包演练**：新包→schema44兼容回退包→新包，在相同合成CURRENT上核对所有数据、新槽、草稿、素材与账本保留；旧段零生成/恢复写，新段恢复正常开关后必须实际接续未完成保存和新旧正常生成。不能将全程关worker的启动检查冒充正常功能通过。
5. **操作门**：重新核对当次活动任务/原未知请求、冻结和停服租约，备份/迁移/回退/新数据验证失败即保持维护。上一轮停服证明和备份不能复用。本轮没有44→43在线降级，也不回灌旧库覆盖CURRENT；迁移提交后只能用理解schema44的包保全或修正向前。

迁移、备份与回退合同的拥有文件在实施时同步：[上线规则](../上线规矩.md)、[发布手册](../RELEASE_RUNBOOK.md)、[生产备份合同](../ops/production/README.md)及实际检查脚本。当前生产仍遵守schema43合同，本方案不把未实施的schema44写成生产现状。

实际生产数据采用前后均保留完整审计，撤销代码不回灌旧数据库覆盖CURRENT、不删新素材、事件或原未知请求。上线、真实数据采用和后续付费生成分别遵守当次授权；本方案审查本身不授权这些操作。

## 10. 独立审查与当前结论

方案评审时：**`PLAN_PASS`**。用户随后已授权本地施工；当前实现与测试进度只由第11节和当前任务拥有。此评审不代表工程通过，也不授权真实数据采用或发布。

| 审查者/独立范围 | 发现与闭环 | 最终文档结论 |
| --- | --- | --- |
| `publication_plan_safety`：输出身份/保存竞争 | 否决原schema43仅事件映射；修订2改schema44唯一槽。其后补齐null published围栏、跨行事务验证、reserve显式复用分支、compensating/quarantine分流 | 原技术方案缺口关闭，方案层PASS |
| `publication_plan_independent_audit`：未参与初稿编写的完整方案审计 | 首轮5项P1：持久所有权、旧双记录canonical、事故证据门、后继run唯一约束、兼容包启动。修订3逐项补齐后复审 | PLAN_PASS，未发现未关闭P0/P1/P2方案问题 |
| `publication_regression_plan`：正常功能/历史备份/迁移回退 | 补齐冻结43/42旧合同、版本分支、结构检查、每份备份对应restore的SHA、新→只读兼容包→新正常恢复及具体V3/V4测试入口 | 原文档阻断关闭；实现与实测仍为硬门 |

方案评审阶段仅检查相对链接、R01—R16矩阵和文档diff，不计为业务测试；当时未改产品代码。后续本地施工已开始，实测记录见第11节。未commit/push、操作Provider/OSS或生产数据。

后续仍需：用户授权本地施工→R01旧代码红测→实现→R02—R16适用项与新旧功能回归→本地兼容回退演练→独立代码复审→本地用户验收。任何一步的失败不能被本文PLAN_PASS豁免；生产操作和真实数据采用继续单独核验当次授权。


## 11. 本地实施与验证

截至2026-09-11本地状态：`LOCAL_TECHNICAL_PASS / LOCAL_USER_PASS / NOT_DEPLOYED`。以下按顺序保留失败与修正记录，最终结论见本节末尾；历史“待关闭”不表示仍未关闭。基线HEAD仍为本文所列提交，原诊断/方案增量保留。R01旧代码受控复现是产品编辑前置门；本地实现后按第7节记录精确结果，工程通过不替代用户验收。


### R01旧代码复现

命令：`node scripts/run-safe-tests.mjs run --spec tests/m88-media-publication.spec.ts`，HEAD保持基线，产品源码未改。测试登记标题沿用m88首个用例，内部增加R01 controlled ReadableStream（highWaterMark=0）barrier与无扫描对照。

- 首轮 `/tmp/unboundry-r01-old-code-20260910.log`：exit1，为夹具缺少owner引起FK失败，不计根因证据。
- 第二轮 `/tmp/unboundry-r01-old-code-20260910-second.log`：exit1；无扫描control已完成保存、发布、task success，扫描后前台读取临时媒体失败。
- 第三轮 `/tmp/unboundry-r01-old-code-20260910-third.log`：exit1；结构化R01快照直接证明扫描在前台body未释放时把task和publication写为failed，期望running/reserved的断言失败。源码快照SHA `9c893cafdf3a2e9807b4bc388f6a505c4fd9a241cc2f75a1a476eff61cefcf2b`，快照及4173监听未改变，安全拦截异常0。登记40项：失败1、其余39未执行；不是全套回归通过。

R01产品编辑前置门通过；后续需同用例转绿，并补齐槽位/续做/旧新回归。

### 首轮修复绿测与集成断点

- 命令：`node scripts/run-safe-tests.mjs run --spec tests/m88-media-publication.spec.ts`；专用Node22.23.1/npm10.9.8、动态loopback与临时DATA。
- `/tmp/unboundry-r01-green-attempt-2-20260910.log`：退出1；旧schema断言43未更新到44，未运行到R01。
- `/tmp/unboundry-r01-green-attempt-3-20260910.log`：退出1；R01所在第1项及其后4项通过；保存中扫描仍为task running/publication reserved，随后原输出结算成功。全m88第6项因原noLedger夹具现在被提前准入时补入账本而不再触发结算缺账本保护，34项未运行；已修正夹具为准入后删除合成账本，再验证结算拒绝，未放松产品保护。
- 本次源SHA256：`7848b7967fd61622d570698426d9b001f5e78d168750e9a6dc5315c9833604de`。135spec/1371tests发现清单、模块边界88条历史例外、源快照/4173未变、运行意外外联阻断数0。
- 当前仅R01绿测成立，不标记全部R02—R16或代码复审通过。后续源已继续修改，最终交付须重新绑定完成树证据。

### 首轮联合回归与修正

- 命令：`node scripts/run-safe-tests.mjs run --spec tests/m88-media-publication.spec.ts --spec tests/m107-generation-result-adoption.spec.ts --spec tests/m108-generation-publication-slots.spec.ts --spec tests/m109-workflow-continuation.spec.ts`。日志`/tmp/unboundry-publication-joint-1-20260910.log`，退出1；执行60项，46通过、14失败、无跳过/重试。138spec/1392tests发现清单，源快照SHA `d944d3b69523bfdca34212d531a74c3fab3295f38371e3762702741079668a1e`，运行后源码及4173未改变。
- m108输出槽/长保存/取消/实际OSS版本删除假传输8项通过；m88为35/41，R01仍通过。m107为1/4，严格采用回执解析漏列canvasId导致3项失败。m109为2/7，5项在读取已恢复上游时受阻。
- m88旧多输出夹具需在首次占位前冻结count并传slot，不能先保存count1后改count2；注入prepare的包装器须透传保存token；取消和删除夹具须符合现有Provider账本保护。产品另发现独立storage返回后暂存清理使用已释放token，已改为重新取得精确所有权后清理。上述修正待重测，不能据此记全绿。

- 联合第2轮`/tmp/unboundry-publication-joint-2-20260910.log`：退出1，业务测试0项；m10所需旧v0.5.1兼容前置演练缺43→44迁移，已按实际迁移入口补齐`check-v051-exact-runtime.mjs`，未改旧v0.5.1不可变包。
- 联合第3轮：同前述命令另加`--spec tests/m10-backup.spec.ts`；`/tmp/unboundry-publication-joint-3-20260910.log`退出1，74项55通过/19失败，无跳过/重试。m88 **41/41通过**，覆盖R01、旧输出恢复、取消、上传/删除和OSS故障找回；m107 2/4、m109 2/7、m10 10/22。新增schema44保全备份→验证→恢复通过；旧43/42/37测试夹具转换及旧schema断言仍需修正。源SHA `ed9cc26af7010822a93cb30ed173dd34f83678d2800d422855d1373daddda069`，138spec/1393tests，源/4173未变，离线拦截异常0。旧v0.5.1前置兼容和不可变包构建门已通过。
- 本轮两个实际逻辑缺陷：原结果采用的账本摘要依赖SQL行顺序，canonical槽提升后排序改变，正改为固定publication身份顺序；后继plan把本次待执行节点误列为external来源，正修正为只冻结已完成上游。保持完整身份和输入核验，待最小重测。

### 首轮独立代码复审发现（当时未通过，最终已关闭）

`publication_final_core_audit`只读审查保存所有权、槽、commit、三类storage、精确OSS补偿；未运行测试，未审adoption/schema/验收。确认三项待关闭：

1. P1：进程在reserved后退出且同步结果无Provider task ID时，扫描始终blocked，缺少明确终态/维护与证据保全路径。
2. P2：原staged文件存在但标记原请求重下载时，冲突可能被误当成“本次尚未staged”而补偿删除已有字节。
3. P2：提交成功后退出，published记录的残余staging未被启动扫描覆盖。

上述为当时未关闭的发现，后续实现及第10c/14轮回归和交叉复审已关闭；审查者曾转为这三项的局部实现者，最终独立复审须由其他未参与对应实现的审查者执行，不能把该作者自检称为独立最终PASS。修复与回归必须保留原Provider/终态保护，不为清理残留删除成品或未决原字节。

### 联合第4轮与正常功能回归

命令：`node scripts/run-safe-tests.mjs run --spec tests/m107-generation-result-adoption.spec.ts --spec tests/m109-workflow-continuation.spec.ts --spec tests/m10-backup.spec.ts --spec tests/m103-server-authoritative-workflow.spec.ts --spec tests/m104-inc-gen-026-reliability.spec.ts --spec tests/m40-generation-idempotency-recovery.spec.ts --spec tests/m40-generation-recovery-worker.spec.ts --spec tests/m40-generation-recovery-scheduler.spec.ts --spec tests/m5-generation-recovery-cases.spec.ts --spec tests/m5-generation-recovery-original-commands.spec.ts --spec tests/m78-generation-recovery-api.spec.ts`。

`/tmp/unboundry-publication-regressions-4-20260910.log`退出1：119项97通过/18失败/4跳过，无重试；138spec/1395tests，源SHA `eb58bc8d527432c7680a7aa2c4bbbe3f4b2f407072325565bf8dc62090bb4ee8`，源与4173不变。m10为20/22，新44保全与旧43/42备份已过，旧37完整链少最后43→44步骤及全表断言仍失败。正常HTTP媒体回归发现新增槽校验误用`url`而现有Provider合同为`transient-url`，本地已修正并以判别联合类型约束入口；不能只以模拟保存测试通过代替此真实产品链回归。另有采用事务内误开新媒体数据库、后继plan夹具范围与旧测试直接插入槽字段问题，均在继续修正。修正后的结果待新一轮复测。

### 联合第5、6轮

第5轮`/tmp/unboundry-publication-regressions-5-20260910.log`在架构前置门退出1，业务0项：新增恢复代码直接跨域读表/内部导入。改为现有Media服务门面和Generation事务命令，架构88条历史基线保持不变，无新增豁免；暂存残留扫描改为每次64条、游标遍历，避免每30秒全表文件扫描。

第6轮命令为安全入口选m10/m103/m104/m107/m108/m109/m40-generation-recovery-worker/m5-generation-recovery-cases/m5-generation-recovery-original-commands/m88；日志`/tmp/unboundry-publication-regressions-6-20260910.log`，退出1，145项140通过/5失败/零跳过或重试。m10 **22/22**、m103 **14/14**、m104正常HTTP生成/整组/单视频补跑 **16/16**、m88 **41/41**、m40 worker **5/5**、m5 cases **14/14**。源SHA `dea114f6833bce304bea3d9dbbad73d8bb28bdbd4980edfd4ff9af796c4938ea`，138spec/1396tests，源及4173不变。m107 4/5仍有真实Canvas采用投影失败；m108 7/8暴露新增扫描丢失旧staged原请求重下载排除；m109 7/9为测试把9个保留节点误等同直接外部输入，正确仅n08；m5 original 10/11为两输出夹具误重复插slot0。后三项已窄修，投影和新独立发现仍待重测，不能记工程完成。

- 第7轮：`/tmp/unboundry-publication-regressions-7-20260910.log` exit1。选定m100/m101/m102/m104-canvas/m107/m108/m109/m110/m5-original/m88/m87/m91–96/m85；按runner顺序先执行前8个spec。m100 22/22、m101 4/4、m109 9/9通过；m102 31/32、m104-canvas 14/16、m107 4/5、m108 10/13；m110首项未登记loopback端口被离线guard拦截，第二项未运行，后续spec未执行。合计94通过8失败1未运行；非全量通过。源SHA`1100ccffb3f5ff5c1edcab96edc2bc034abac00b0858c74c8af8e63da516a38c`，138spec/1401tests，源/4173未变；安全拦截1次仅未登记loopback、无外部请求。当前已纠正夹具任务prompt/参数、旧文本测试函数边界、注册端口、槽值与store释放等待，待复测。独立复审另发现复用PNG checksum冲突误走补偿；改为EvidenceConflict保留原数据，补回归待验证。续跑完整媒体身份和跨标签previewDigest核对补丁仍待整合。

- 第8轮：`/tmp/unboundry-publication-regressions-8-20260910.log` exit1，15spec/197项：192通过5失败，无跳过/重试、离线异常0。m102 32/32、m104-canvas 16/16、m107 5/5（含Canvas写回失败整采用回滚再恢复）、m108 14/14（含原staging checksum冲突保留）通过；m5-original 11/11、m85 31/31、m88 41/41及所选m92–96通过。m110独立只读程序通过，真实应用新→只读→新已保存staged结果，但周期清理未完成；查明safe默认关闭sweep，child现显式启用正常开关待复测。m87 3项为旧夹具缺槽及错误冻结版本，m91 1项为以44合同验证历史43，已修夹具/使用冻结43合同，未放宽产品门。源SHA`c9f998e2b75b238b7117b08bcbe3060f8bd269b20cf4e51605b68df3b99f44aa`、138spec/1402tests/982files，源与4173不变。根代理另修采用投影失败却提交和replay假报投影：意外失败整事务回滚，真实冲突保留，重复通过幂等Canvas命令核验；m107已覆盖并通过，独立复审待结论。

- 第9轮：`node scripts/run-safe-tests.mjs run --spec tests/m87-media-integrity.spec.ts --spec tests/m91-schema-migration.spec.ts --spec tests/m110-schema44-readonly-preservation.spec.ts --spec tests/m109-workflow-continuation.spec.ts --spec tests/m107-generation-result-adoption.spec.ts`；`/tmp/unboundry-publication-regressions-9-20260910.log` exit1，37项34通过/3失败，无跳过/重试/离线异常。m87 8/8、m91 12/12通过；m110只读程序通过，但正常应用恢复后的暂存清理仍失败；m109新媒体夹具漏写externalNodes导致原计划校验失败，已补齐待测。m107新增用量快照发现采用时publication空值覆盖原任务用量；已限定采用路径保留原费用/用量，普通生成结算不变，待复测。源SHA`d20e518ef054c0016825bfe3a6145ce34efa8a67e4ab1b77f752eec16050f512`，138spec/1403tests，源与4173未变。完整媒体身份已合入，父计划已冻结的素材不得在连续续跑时重新冻结为替换后的内容。UI只读自动核对补丁及4个行为用例已整合，仍待测试。


### 第10—12轮与独立复审增量

- 第10轮a/b仅前置检查失败，业务0项：新增m112使node spec数量从44变45，以及修改runner后其覆盖manifest目标hash未更新。修正登记/hash后执行第10轮c，未绕过检查。
- 第10轮c命令：安全入口选择m104-inc-gen-026-reliability、m107、m109、m112、m41-generation-recovery-cases-ui、m41-generation-retry-ui、m86、m98。`/tmp/unboundry-publication-regressions-10c-20260910.log` exit1；223项220通过/3失败，无跳过/重试/离线异常。m107 5/5（原费用/用量保留）、m109 10/10、m112 4/4、m41两组5/89、m98 5/5通过；m104两个正常图片流程失败，查明完整冻结媒体核对调用了仅允许事务内的Media门面，误伤普通准入；现恢复普通节点原媒体输入路径，完整字节/哈希/存储身份仅约束后继冻结输入，并使用现有beforeCommit在准入事务内再次核对。m86一个旧夹具期待忽略外画布task，与基线严格身份校验不符；改为先验证读取失败，再验证下一次合法空列表自动恢复，产品身份门不变。源SHA`478c4171edfb99e344239a353efcbd63d14f9b3d28a47c20929bc52b390a7d9f`，139spec/1407tests/983files。
- 第11轮命令：安全入口选择m104-inc-gen-026-reliability、m109、m110、m86。`/tmp/unboundry-publication-regressions-11-20260910.log` exit1；117项116通过/1失败，无跳过/重试/离线异常。m104正常生成16/16、m109后继10/10、m86画布安全89/89通过；仅m110撤销后清理失败。源SHA`0c3e6a9baba9a0216f5638b3d8aec11bcae8abb221dc600a01c3a4b6537f2c7b`，139spec/1407tests/983files。
- 第12轮命令：`node scripts/run-safe-tests.mjs run --spec tests/m110-schema44-readonly-preservation.spec.ts`。`/tmp/unboundry-publication-regressions-12-20260910.log` exit1；2项1通过/1失败，无跳过/重试/离线异常。实际child stderr显示release被`Application database is not the exact current schema`拒绝，非成功任务不允许清理，也非仅等待不足。合成staged视频记录了有效duration但duration_status仍pending，与真实stageMediaPublication立即标ready不一致；修正夹具并增加恢复后完整数据库重开门，待重测。源SHA`1fad4f2fc913eae1cb37c57d33b3f4c99b32e6c0a052e6adcaef5285017cf0ce`。以上运行源码快照和4173监听均未改变，不把重复用例相加成独立覆盖数。

独立作者分工：`publication_schema_backup`复审非本人编写的保存冲突保全、采用投影/费用保留、完整冻结媒体及beforeCommit事务窗；未发现未关闭P0/P1。`publication_final_core_audit`复审非本人编写的schema44只读包和回退，确认历史37→39 bridge入口仍是历史迁移链合同，撤回此前误报的P1；另指出无活动任务时残余staging启动清理遗漏P2，现已由第14轮专门回归关闭，最终交叉审查确认无遗留P2。


- 第13轮：只跑m110；`/tmp/unboundry-publication-regressions-13-20260910.log` exit0，2/2通过，3.8秒。已确认第12轮为不符合真实stage合同的夹具；正常新→只读保全→新同CURRENT、自动保存与清理、未知账本/草稿/媒体保留及零Provider POST通过。源SHA`54638d6802b2cbeef539dbed98d00905abd79121ada136ee19b93c16960c05ff`。
- 第14轮：`node scripts/run-safe-tests.mjs run --spec tests/m110-schema44-readonly-preservation.spec.ts --spec tests/m108-generation-publication-slots.spec.ts --spec tests/m88-media-publication.spec.ts --spec tests/m81-deployment-hardening.spec.ts --spec tests/m38-generation-runtime-incidents.spec.ts`。`/tmp/unboundry-publication-regressions-14-20260910.log` exit1，120项116通过/4失败，零跳过/重试/离线异常。m10814/14、m1103/3、m8841/41通过，idle启动真实清理仅残余stage、保留成品和旧task且不POST，关闭原清理遗漏P2。m38 17/19：纯退避测试误复用其他fixture全局store，已补显式测试端口；文档要求的固定栏目漏写，已补齐。m81 41/43，旧37和旧版本维护夹具待修正，未放宽产品数据库检查。源SHA`3d1102671d3842d1fd95f239456e56cefb9fb3d023b4fe40351d9fed8b013f5e`，139spec/1408tests/984files，源和4173不变。

- 第15轮：安全入口仅选择m38/m81，`/tmp/unboundry-publication-regressions-15-20260910.log` exit1，62项61通过/1失败，零跳过/重试/离线异常。m38 19/19通过（含文档治理）；m81 42/43，补齐旧fixture 44→43→42→37后原两个阻断关闭，继续运行暴露迁至当前版本后的末条ledger断言仍写43，已按实际44迁移记录修正，历史旧版行为断言保持。源SHA`455a1e719d67acff01c5adce56f9ba47c0f9bf84482b07a8fafea3bc05a1f6ef`，源/4173不变。

- 第16轮：安全入口仅选择m81，`/tmp/unboundry-publication-regressions-16-20260910.log` exit0，43/43通过，零跳过/重试/离线异常。覆盖正常启动、旧schema不隐式迁移、维护/只读零写、启动worker和退出等待，旧fixture修正未放宽产品门。源SHA`b5665804bf6ff5af97baa7ee7b2b3d42a6d4d0289711ff4fef26f894ea008e4c`，源/4173不变。业务回归已分组通过，验收辅助页面仍在实跑前校验；不能据此标USER_PASS或已上线。


### 同页验收辅助脚本实跑与最终结论

以下失败均来自新建的本地合成夹具/验收辅助脚本，不能用安全进程正常关闭或静态审查代替页面功能通过。未修改生产或放宽产品检查。

- `node scripts/run-safe-tests.mjs acceptance --scenario media-publication` 第1—6次启动日志位于 `/tmp/unboundry-media-publication-acceptance-{1..6}-20260910.log`。依次修正：应用先开库导致旧schema夹具表已存在；无配置SSR loader的默认WebSocket监听被离线门拦截（改为禁用ws）；成功文字缺modelId；旧schema输入读取错误进入current全局连接（改用已有事务内读取合同）；task和publication两条合成INSERT的列/值数量不匹配。每次失败已结束清理，只重启此辅助场景。
- 第7次已启动并实际打开浏览器，但页面显示数据库不可用；诊断确认 `schema_migrations` 合成建表字符串与产品精确物理schema指纹不一致。已按产品原文格式修正，并在辅助页宣告ready前增加实际current打开检查。该次进程安全关闭exit0只证明清理完成，页面验收失败，不能记技术/用户PASS。
- 测试PNG由不可观察的单色1像素改为合成320×180蓝绿白色图片；成功文字现在含真实已存内容，节点标题与指引对应，正常图片与视频不再重叠。Grok两个未完成视频都引用找回的PNG，避免夹具误用该模型不支持的视频输入。上述均为测试素材/数据修正，不改变产品模型合同。
- 独立静态复核确认合成Provider的AES-GCM/AAD/32字节主密钥及SQL配置签名与现行产品一致；节点定位的搜索筛选残留问题已修。第一项将采用真实本地视频body保存窗口与恢复扫描（复用R01共同发布链），第二项单独验收PNG找回；不使用仅返回307却没有可读对象的模拟上传来冒充图片显示。尚待实际四项点击及最终独立复核。

- 第8次实际浏览器显示画布不完整，修正合成 Canvas revision 3 / graphRevision 7 的错误为7/7；第9—11次实点到保存成功但投影失败，诊断最终确认夹具顶层 modelReleaseRevision 必须是完整 release 对象，workflowBinding 内仍用 revisionId。第12次第一项后台保存/恢复/投影/视频 GET 均通过；第二项暴露合成 request_fingerprint 非合法64位SHA，已修正，同时 task.prompt 使用真实 preflight.finalPrompt，未降低产品身份检查。
- 第13次三个真实后台动作与内容保护均通过；但第2项辅助页自动 reload 超时，手动刷新可见原图。修正为仅在后台动作完成并重读后定位，移除动作前自动进入节点编辑器的多余定位。该轮另通过浏览器检查图片“浏览全部”菜单高于输入框、右加号拖出来源菜单并点击创建Text、新连线持久化，以及缩放和刷新；临时数据库最终10节点/5连线，新Text存在。证据：`/tmp/unboundry-media-publication-acceptance-13-20260910.log`、`/tmp/unboundry-media-publication-run13-journal-20260910.json`。不把本轮自动reload失败写成整页通过。
- 第14次最终实跑：`node scripts/run-safe-tests.mjs acceptance --scenario media-publication`，日志`/tmp/unboundry-media-publication-acceptance-14-20260910.log`。浏览器依次点击四项，第一项实际播放视频，第二项自动显示PNG并刷新保留，第三项两视频 success/applied，第四项原内容保护通过；页面无error。实际请求视频POST2、图片POST0、未知模型POST0，外部付费请求0；原3文字节点内容/位置/连线不变，旧父run保持failed。完整状态与journal：`/tmp/unboundry-media-publication-run14-status-20260910.json`、`/tmp/unboundry-media-publication-run14-journal-20260910.json`。主动结束后exit0，源快照`abb430353513f78f196091ecdc1ddffcd48aaea42235e880927015fa6f113ba8`不变，4173未动，临时DATA清理完成；没有把单纯exit0当功能通过。

最终独立交叉复审：`publication_schema_backup`确认非本人实现的保存所有权、原staging冲突保全、idle清理、采用投影/费用用量、续跑冻结输入及beforeCommit范围无已知未关闭P0/P1/P2；只读桥接与回退由`publication_final_core_audit`交叉审查。验收脚本真实API路由、模型合同、focus/reload范围及不冒充USER_PASS由`publication_final_core_audit`复审，无P2及以上；夹具采用身份/媒体/槽与后继绑定由`publication_regression_plan`只读复核，无新阻断。该结论针对本次受影响范围，不是全仓或真实平台全量审计。

本地工程交付及四项用户验收已完成，用户确认由[验收账本当前增量](UNBOUNDRY_ACCEPTANCE_MATRIX.md)维护。相关业务回归沿用本节已通过的各最终分组证据；之后只改验收脚本与文档，没有重复无关全套测试。撤销演练是本机真实新应用→独立schema44只读保全程序→新应用，不是旧schema应用读写或Linux生产演练。本地验收交付当时未提交、推送、改版本或上线；生产原task/双素材记录保持原样。后续版本准备见第12节。原交付会话从四项idle开始，现已停止；用户通过不等于本次发布授权。

最终文档同步后仅复跑m38：`node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`，`/tmp/unboundry-media-publication-docs-final-20260910.log`，exit0、19/19通过，零失败/跳过/重试/离线异常；源SHA `f4fae55d0581c1fd2938c476977387afdf3cab6172ab9048d0539c75d32109fc`，源与4173不变。该次涵盖恢复异常路径及当前文档单一权威检查。


## 12. v0.7.18发布准备（2026-09-11，历史阶段记录）

本节以下按当时阶段保留，不代表当前生产。现已完成程序与数据库切换；精确最终状态见[发布回执](V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)和[当前任务](../TASKS.md)。

用户在四项本地验收通过后回复“授权”，授权本次发布检查与上线；该授权继续有效。拟用未占用的v0.7.18，已在本地更新package/lock和精确运行准入。第9节要求的schema43→44生产迁移及其维护回退影响已于2026-09-11获用户明确回复“同意 数据库也得对齐的”；本次授权包含必要迁移及已说明的维护回退，不重复确认。授权不等于迁移、停服、云备份或正式发布已发生。

本轮只读复核：GitHub main仍为`3eae6840ec3ac825e7e3908fc7b8f66692228db2`，v0.7.18 tag不存在，当前无开放PR；正式current仍指向v0.7.17-node-recovery-20260908，Node22.23.2、schema43、PID1909187、restarts0、ready200。任务共1131条，仅旧未知视频9c93f308-bb77-4935-a4e3-37dd72e6cd28在recovering，attempt1/outcome-unknown且无Provider task ID；工作流6 failed/8 success，publication11 failed/596 published。它们只是本次检查时快照，停服前必须重新采集，不可复用为冻结证明。

本地新增验证：`node scripts/run-safe-tests.mjs run --spec tests/m81-deployment-hardening.spec.ts --spec tests/m38-generation-runtime-incidents.spec.ts`退出0，62/62通过（43启动兼容+19生成错误/文档），无失败、跳过或重试；隔离类型/架构/构建通过。Node22.23.1/npm10.9.8；984源码文件快照SHA`96644ea559fcb96331e4f6eec19aa0eecfc861e3e6b5dc0cd914e6ffee1e017f`，前后源和4173不变。日志`/tmp/unboundry-v0718-release-checks-20260911.log`，SHA`2c7b48e33a9c05aa91c4531bf3a7503769958ccb2878b6284b07131de5783c1e`。按验收前清单逐文件比较，本轮只改版本/准入/相关版本测试及TASKS、当前状态；业务修复源码未变，复用第11节仍有效的业务证据。

独立只读审查`release_preflight_audit`通过四个版本文件增量，未发现新P0/P1/P2；此结论不代表生产迁移操作已经审查/演练通过。历史0.5.2/0.6.0构建工具不能直接用作本次发布器，旧v0.7.17备份和Mac m110证据也不能代替新的Linux发布门。

后续精确顺序：版本/迁移及维护回退已确认 → 精确提交、PR/main CI、tag与不可变新包 → 独立Linux合成CURRENT的新→维护桥→新实跑及操作脚本复审 → 最新实际冻结/停服schema43备份、verify、fresh restore → 同一CURRENT迁移dry-run与apply → schema44独立备份/verify/fresh restore、按当次数据建立只读保全包 → 正式启动与公网资源/版本/数据核对。每一门失败按审查后的阶段规则停止，schema44提交后不启动旧schema43应用、不回灌旧库；进入保留数据的维护页，待兼容修复后恢复。

真实原图采用、旧工作流付费后继执行、删除历史数据/备份、云权限和每日自动备份仍不属于这次默认发布范围。正式站付费生成须另有用户指令。生产迁移、云备份、回退演练和上线的实际证据待执行后补录，不能预写PASS。


操作单复核新增阻断：候选`backup-data.mjs`的`parseQuiescedSourceContract`仍写死43，`parseFrozenSourceContract`把quiesced与历史模式合并为≤43；底层API虽已有44保全回归，实际CLI不能采集44未知任务。禁止草案用普通locked-exact绕过该问题：线上仍有outcome-unknown，应保持原账本并继续quiesced独立模式。已局部修正CLI允许精确43/44，历史恢复仍37—43、普通当前备份仍44，quiesced保留调用方精确schema；修复只影响备份入口，不改变已验收画布/生成流程。新增真实CLI在43/44两类未知任务上执行backup→verify→fresh restore并核对logical SHA、integrity/FK、未知任务、无源目录改动，23项m10全部通过，独立非作者代码复审已通过。


备份CLI验证：`node scripts/run-safe-tests.mjs run --spec tests/m10-backup.spec.ts`，exit0、23/23（新增1项循环覆盖43/44）；无失败/跳过/重试/离线异常，139spec/1409test为发现分母，984源码快照`2c3e50e2ff4f2e4119e91dd2a02f33020da58871d9578f9beee42ce069c26f71`前后不变、4173不变、临时数据已清理。附加合成immutable-release-builder门通过，不是本次生产tag构建证明。日志`/tmp/unboundry-v0718-backup-cli-20260911.log`，SHA`0aff0cf3c29fac1e33a88ff5036bf6792ef75e6804b32d44e1219f86343f3184`。源码覆盖入口`/Users/mymy/.hermes/node/bin/node scripts/check-source-coverage.mjs`亦exit0/pass（559代码文件，501TS、58JS），日志`/tmp/unboundry-v0718-source-coverage-20260911.log`，SHA`6a4ff1e51091dcb81086dc91ad7f9bc88f2d1b0a86e6831345c431961a0c9330`。本轮只同步新增测试发现数与受影响脚本/测试哈希，不降低原检查。


备份CLI独立复审：`schema44_release_operations`（非该代码作者）只读检查精确schema模式分支、组合拒绝和真实CLI回归，结论PASS、无P2及以上；租约、停服、冻结、密钥、媒体闸门未降低。`release_preflight_audit`为CLI/新用例作者，主代理执行安全测试并交叉检查diff。提交候选时必须显式纳入`tests/schema-fixtures.ts`及全部本次新增实现，不能把当前未跟踪依赖漏掉。

操作草案保存在`/tmp/unboundry-v0718-release-ops-draft-20260911/schema44-release-ops-plan.md`及`render-schema44-release-ops.sh`；后者仅输出命令（MODE=render-only/EXECUTED=0），不是生产执行器。主代理语法检查通过，首版错误的44 locked-exact步骤已撤换为quiesced；真实输入/脚本身份/命令清单和Linux执行仍须按精确发布包审核，不直接复制占位命令进生产。数据库已变更后的每次维护桥接均须重新绑定最新停服CURRENT，不能复用旧SHA manifest。

当前断点：本地发布准备与备份入口修复已完成；用户已确认本次版本、数据库升级及维护回退影响，继续精确包CI/Linux演练及生产发布。准备、测试和独立复审均不冒充备份、迁移、正式Linux回退或生产上线已完成。正式站未被本轮修改。

发布政策独立复审：`release_policy_review`只读核对发布手册、上线规矩、备份合同及当前任务，确认已审范围内必要迁移随版本发布、不重复确认；迁移前后备份/verify/fresh restore、精确包Linux演练、独立操作复核、维护回退及付费/删除边界保留。结论PASS，范围仅本轮政策增量。候选提交前修正两处无行为影响的行尾空白并同步迁移脚本coverage SHA，源码覆盖再次通过；业务代码语义未变。

精确候选已由PR175合并，branch CI34505564475和main CI34506035015两组均success；产品merge `0eddf365573cc47e535aa92b95e68f3c577479e6`、tree `b7ea9c637f3ae0f31a2392f9e3d42bbc1f9c2d7b`，annotated tag v0.7.18对象`1b92050fa7c0251076411e18246692532c752c12`。GitHub Release已建立，尚不代表服务器切换。984文件allowlist导出archive SHA `29de3e3b2d71c8a89a72c2ac5252c5cc2d567c3eecf8cd68b4d2f07f3ddd40bd`，identity SHA `7613f390427457ceacb7b4ce67ab9efd8e57e6a7168c8626ced5f07fb767bd54`；两受保护路径先排除。独立导出脚本复核要求显式异常检查和禁用git replace，均已修正，最终复核PASS。

Linux演练初版证据边界：`/tmp/unboundry-v0718-linux-rehearsal.Evq6JT`使用手写简化表、模拟worker/SQL结算，主代理检查实际启动代码后拒绝将它作为真实应用恢复或精确包发布门；只保留其只读桥接协议/网络隔离范围，不能宣称正常产品worker通过。已要求改用精确安装包的真实bootstrap与自动恢复，最终门待重新执行。失败/局限记录保留，不覆盖为PASS。


### 生产切换与收尾（2026-09-11）

精确v0.7.18已上线，数据库43→44及两侧保全备份/verify/fresh restore、真实Linux新→只读维护→新演练、生产最终数据核对通过。第一次操作在迁移前补偿，第二次完成切换；实际失败和两项窄范围运行期差异均记录在[发布回执](V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)，不覆盖历史失败日志。公网资源与私有云备份核对、最终文档同步状态仅由当前任务和回执维护。正式登录后画布及付费生成未冒充通过；历史失败结果未由发布过程采用或重发，暂停项保持。
