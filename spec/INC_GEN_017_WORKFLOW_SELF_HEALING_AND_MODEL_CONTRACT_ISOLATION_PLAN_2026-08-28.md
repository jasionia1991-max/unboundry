# INC-GEN-017：工作流自动自愈与模型合同隔离详细行动方案

状态：`GOAL_ACTIVE / FORMAL_SAFE_FULL_CONSUMED / V0_6_58_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_59_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_60_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_61_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_62_PR_OPEN_FINAL_CI_PENDING / REAL_PROVIDER_NOT_POSTED / USER_RECHECK`

建立日期：2026-08-28

v0.6.62分支已推送并创建PR #131，base/head=`main@fe93d835`/`3aef7e8`，mergeable。首个Quality gates/lightweight run=`33312070069`、job=`99258820272`正在运行。现在只提交并推送本条治理回执，等待最终纯文档head同一门通过；随后才合并、验证main CI并建立annotated v0.6.62 tag/GitHub Release。

v0.6.62实时GitHub身份门通过：`origin/main@fe93d8359a5a3ee5f8bfe1d64f494ec87d4b8d3f`未前进且为merge-base；本地/远端tag与Release均未占用，同head PR不存在。PR差异精确16个预期文件、845 insertions/49 deletions，无受保护JSON。提交本治理回执后推送并创建PR；只在最终head Quality gates通过后合并并建立annotated tag/Release。

候选提交后的safe m38=`16/16 PASS`，source/snapshot=`76716e8779c6a051e087bc3a0bfaf9046fc920e86d01cde7dbeb4985cd2fc747`，库存1125，失败/重试/跳过/reportErrors0，HEAD=`fe152fe35d70dddd2b4e8b201f83ac2635df9241`，Node22.23.1/npm10.9.8，4173 unchanged。下一步单独提交六份治理文档，再执行GitHub身份门；不得把受保护JSON纳入任何commit或PR。

冻结候选已精确提交为`fe152fe35d70dddd2b4e8b201f83ac2635df9241`，tree=`079464b77bbdb226a6fb11c9c4b159fa64590ce1`；commit只含10个产品/版本/测试文件、611 insertions/35 deletions，六份治理文档和受保护JSON均排除。下一步只运行提交后治理m38，再单独提交六份治理回执并进入GitHub身份门。

独立Review GO回写六份治理后的safe m38=`16/16 PASS`，source/snapshot=`ce9126ef4216e1ccad2d80194c51653aa1b3cf64abeb915f1a5afde8d8313fac`，库存1125，失败/重试/跳过/reportErrors0，Node22.23.1/npm10.9.8，4173 unchanged。正式full不重跑，冻结产品hash仍为`bb364480…ae897`。下一步精确提交10个产品/版本/测试文件，再运行提交后治理m38；治理文档与受保护JSON不进入候选commit。

冻结hash`bb364480…ae897`的既有独立审查上下文已完成只读终审：覆盖10/10文件、53/53 hunks、611 insertions/35 deletions、完整schema/模板聚合/迁移/事务/rollback/repeat链、10/10 logical models、11/11 exact identities、6/6 adapters及全部Provider分支，最终`P0=0/P1=0/P2=0/GO`。mixed-template上一轮P1确认关闭，无finding；候选树未变，审查未测试/build/联网/Git写/Provider/OSS/生产，受保护JSON未读取。现在只运行Review GO治理m38，然后精确提交候选与治理回执。

v0.6.62主审GO六份治理同步后，safe m38=`16/16 PASS`，source/snapshot=`bb2f43164ab91e200779c38cb1ab4ac9a3c6e88a65e7132b98fdf944dc1d6d3c`，库存1125，失败/重试/跳过/reportErrors0，Node22.23.1/npm10.9.8，4173 unchanged。正式full永久不重跑；冻结产品hash保持`bb364480…ae897`，立即进入既有独立审查上下文只读终审。

v0.6.62混合模板整改后的主线程最终Review已逐一读完10/10改动文件、53/53 diff hunks与所有关键分支，候选611 insertions/35 deletions。完整调用链覆盖schema exact/near-miss→真实active/proposed模板兼容→逐模板节点聚合→Grok模板迁移/摘要→dry-run/attestation/baseline CAS→Templates域同步事务命令→逐模板CAS→revision/activation/audit→异常整体rollback→repeat action none；横向覆盖10/10 logical models、11/11 exact identities、6/6 adapters与全部Provider提交/轮询/恢复/取消/结果分支。结论`P0=0/P1=0/P2=0/GO`，diff hash=`bb3644800553fbe5d7b303e19ec47e33d3d73ae5e6142933e2bece64527ae897`并冻结。下一步先运行六份治理同步后的safe m38，再由既有独立审查上下文对精确hash只读终审；独立`P0/P1=0/GO`前继续禁止commit/GitHub/生产/Provider。

隔离复验治理门已闭合：六份治理同步后的safe m38=`16/16 PASS`，source/snapshot`91c82e9a…ba85`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged。当前按Review协议只做精确候选diff/hash、逐文件/逐hunk/完整链/全模型/全Provider分支主线程Review；正式full不重跑。

v0.6.62混合模板整改后的全新隔离dry-run/apply/repeat已通过。主副本`pLv6YJ`使用当前8个产品/版本文件覆盖的独立staging`U403Kn`，attestation`d49ea1a1…47cbb`；dry-run`d3f27a13…a8d1`/plan`8c0dc03c…cc05`，apply`101e0c54…7739`，DB从原始冻结SHA迁为`55006ca1…6198`并完成5 revision、22模板/34节点。repeat兄弟副本`MhUhK0`的dry-run`9191a7cb…9c3c`/plan`5ff907cd…46f2`为11/11 none、迁移0，apply`d892496f…98db`且DB字节级不变。完整性、FK、active、34 image/0 reference和脱敏audit门通过；生产仍v0.6.57/schema41健康且未写，Provider0/USD0。首次新复制目录因shell取值错误在CLI前停止并保留。当前只允许治理m38、精确Review/冻结及既有独立上下文复核；正式full永久不重跑。

v0.6.62混合模板P1已按最窄边界关闭：analyzer现在逐模板聚合节点结果，只有所有不兼容目标节点在真实active/proposed两侧都失败且graph可解析时才进入preexisting；同模板任何before-pass/after-fail等新增回归都保留为blocking。m102构造历史双失败节点与空格modelId迁移selector near-miss共存，证明plan阻断且apply在写入前停止。TypeScript/diff-check通过；safe m102首轮`23/24`只是测试未接受更早的生产矩阵硬门，精确对齐后最终`24/24 PASS`，source/snapshot`909b1cc8…d3c0`、库存1125、异常0、4173 unchanged。产品语义已变，下一步只建立新的隔离dry-run/apply/repeat证据，再重新精确Review/冻结/独立终审；正式full永久不重跑。

v0.6.62独立只读终审覆盖冻结hash`29e09816…2f55`的10/10文件、50/50 hunks、完整链、10/10 models、11/11 identities与6/6 adapters后给出`P0=0/P1=1/P2=0/NO-GO`。P1是analyzer在任一节点before/after双失败时直接把整个templateId加入preexisting；upgrade再按templateId过滤，可能让同模板另一个before-pass/after-fail新增回归随历史债务一起被扣除。候选已解冻；整改只改节点聚合规则与混合模板回归：模板内所有不兼容节点都必须为双失败，且无unparseable/新增回归，才能归入preexisting。随后最小运行m102/TypeScript/diff-check，因产品语义改变重跑隔离dry-run/apply/repeat，再重新主线程/独立全量Review。审查一次只读误扫非受保护治理spec已如实记录且不采用其内容，受保护JSON未触碰。

v0.6.62主线程最终Review已逐一读完10/10改动文件、50/50 diff hunks和所有关键分支，候选500 insertions/33 deletions。调用链覆盖schema exact/near-miss→target document→真实before/proposed after模板兼容→Grok模板before/after hash与迁移摘要→dry-run/attestation/baseline CAS→Templates域同步事务命令→逐模板CAS→revision/activation/audit→任一异常整体rollback→repeat action none；横向覆盖10/10 logical models、11/11 exact identities与6/6 adapters及其Provider提交/轮询/恢复/取消/结果分支。结论`P0=0/P1=0/P2=0/GO`，diff-check通过，hash=`29e098164e9d996565f7e7b9c57df3738c84c8b783640ddc7e2d589f14c42f55`并冻结。下一步仅由既有独立审查上下文对该精确hash只读终审；不得测试/build、联网、Provider/OSS/生产、Git写入或读取受保护JSON。独立`P0/P1=0/GO`前继续禁止commit/GitHub/生产/Provider。

v0.6.62隔离迁移回执完成六份治理同步后，只运行治理safe m38并取得`16/16 PASS`；source/snapshot=`57f644da93e3c1520cf51d8003fc0b4e24376da92f909d2f53c9e2fe6648d006`，库存1125，失败/重试/跳过/reportErrors0，Node22.23.1/npm10.9.8，4173 unchanged，架构/TypeScript/production build前置通过。正式safe full保持已消费。现在按硬门执行精确候选文件/hunk/统计/hash，再由主线程逐文件、逐diff、逐关键分支、完整事务/CAS/回滚/repeat链、10/10 logical models、11/11 exact identities与6/6 adapters全量Review；P0/P1清零后冻结并交既有独立上下文终审。

v0.6.62最终模板事务迁移已在真实冻结恢复副本闭合：主副本`v0.6.62-contract-recheck.qE9j6A`的dry-run报告SHA=`d3f27a13…a8d1`、plan hash=`8c0dc03c…cc05`；apply报告SHA=`37e7f100…7194`，DB从`13589eea…2261`变为`19ed87b8…039`，精确升级五个legacy revision并以同一事务迁移22模板/34节点，复核为`image=34/reference=0`且audit无graph正文。新兄弟副本`v0.6.62-contract-repeat-template.20260830a`、attestation SHA=`34864a3d…c5b5`的repeat dry-run SHA=`e7019f57…2c66`/plan hash=`760e0da9…9fd4`为11/11 action none、迁移0；repeat apply SHA=`7884ff99…8c7e`、`upgradedModels=[]`且DB字节不变。schema41、quick/integrity ok、FK0、active0，Provider POST=0/USD0，生产保持v0.6.57/schema41且未写。下一步严格先同步六份治理并仅跑safe m38，再做精确diff/hash、主线程逐代码Review、冻结及同一独立上下文只读终审；P0/P1清零前不进入GitHub/生产/Provider。

v0.6.62真实模板旧值不再被当作可扣除债务，而由精确事务迁移承接：仅exact legacy Grok3的`publish-revision`计划扫描已发布模板，把目标节点`videoParameters.inputMode=reference`按现有首帧边迁为`image`、无首帧迁为`text`；对外计划和audit只记录template/node与图hash。apply使用Templates域transaction-scoped command逐行graph CAS，与模型revision发布和audit共享同一事务；任一CAS/发布失败整体回滚，repeat action none不规划迁移。首次直接SQL实现被架构预检以`CROSS_DOMAIN_SQL`阻断，改为域命令后通过。m102两次`23/24`分别证明测试图缺legacy存储形状、夹具范围过宽；最终精确夹具`24/24 PASS`（source/snapshot`8942d621b2d0a884401a656d909be0552317cf4d93f118eb0d9845c29ba748f4`、库存1125、异常0、4173 unchanged），TypeScript/diff-check通过。下一步用该最终代码重跑隔离dry-run/apply/repeat；旧隔离证据不可替代本次复验。

v0.6.62独立P1整改已完成：exact proof只允许analyzer跳过宽泛的identity-preservation结论，不允许替换before合同；`modeForNode`分别以真实active/proposed验证参数和模式。迁移阻断集只扣除analyzer本身确认的两侧均失败preexisting；active-pass/target-fail和unparseable保持blocking。新增精确Grok legacy-only selector回归，TypeScript/diff-check与safe m102 `24/24 PASS`（source/snapshot`8ccaa3cd…c880`、库存1125、异常0、4173 unchanged）。因产品迁移逻辑已变，先重跑隔离真实副本dry-run/apply/repeat，再重新主线程/独立全量Review；旧隔离apply证据保留历史但不替代新代码复验。

v0.6.62独立只读终审对冻结hash`32345132…3f9b`结论为`P0=0/P1=1/P2=0/NO-GO`。P1是exact template bridge把target作为before/after并批量扣除parseable incompatible，掩盖active-pass/target-fail回归。候选已解冻；最小整改为compatibility analyzer显式接受已证明的runtime-equivalent schema transition，只跳过execution-preservation差异判断，但before仍用真实active、after用proposed；blocking严格按after fail且before pass，preexisting严格按before/after均fail，unparseable始终blocking。补exact old-valid→new-invalid回归后只重跑m102/TypeScript/diff-check，再重新主/独立Review。

v0.6.62主线程逐代码Review现已覆盖8/8文件、31/31 hunks、321 insertions/16 deletions、完整迁移/schema/template/attestation/CAS/transaction/activation/immutable/repeat链、10/10 logical models、11/11 exact identities和全部6类adapter，结论`P0=0/P1=0/P2=0/GO`。diff-check通过，候选hash=`32345132965ccebf0c50b5c5d2f661af326188c9f0e73f512080aa8afc863f9b`并冻结；下一步只允许既有独立上下文只读终审。独立GO前不commit、不进入GitHub/生产/真实Provider。

v0.6.62隔离迁移阶段治理safe m38已`16/16 PASS`，source/snapshot=`8a12f5b7402bba528b6caf4a2ccf17583d5112359510d3cb0fc54d91a9c1c11b`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged。正式full保持已消费且不重跑；下一阶段只做精确diff/hash、主线程完整增量Review、冻结与独立只读终审。

v0.6.62隔离真实副本dry-run/apply/repeat现已全部闭合，生产未写。主副本最终dry-run报告`95cd8ffb…e9d`、plan hash`51ec14bc…e05`；首次apply报告`9c1cc84b…66af`，五个精确legacy模型升级，隔离DB变为`66554d03…1fb`。首个repeat apply在任何写入前发现无动作Grok仍错误执行22模板/34节点矩阵断言，安全fail-closed且DB未变；实现已改为仅`publish-revision`动作执行该断言，并新增m102回归。干净兄弟副本`v0.6.62-contract-repeat.20260830a`最终全11身份action none，repeat apply报告`b1e766b6…4158`、`upgradedModels=[]`、DB前后字节级同SHA。隔离库schema41、quick/integrity/FK/active/unsettled门通过；生产仍v0.6.57/schema41、原DB SHA`13589eea…2261`，Provider POST=0/USD0。当前safe m102=`24/24 PASS`，source/snapshot=`34a24549034f773892760f994296a040a348cf93f138b265d93677b41299123a`、库存1125、异常0、4173 unchanged。下一步只允许治理m38、精确diff/hash、主线程全量增量Review、冻结与独立只读终审。

v0.6.62隔离真实副本首轮dry-run越过Grok3.5 exact schema门后，在apply前暴露模板分类门把目标合同下前后都失败的历史债务同时计为`preexisting`与阻断`incompatible`。整改不改变普通发布分析器：只对GPT Image 2/Grok3/Grok3.5三个已有字面exact runtime-equivalence证明的迁移，用target合同双侧比较并将可解析preexisting项从阻断集扣除；unparseable graph、非exact迁移和任何新增回归继续阻断。m102新增exact历史债务可迁移与非exact Seedance仍阻断的正反例；三次`23/24`仅为fixture ID重复/graph结构无效诊断，最终`24/24 PASS`（source/snapshot`e1f9e974…abc52`、库存1125、异常0、4173 unchanged），TypeScript/diff-check通过。下一步只重跑隔离dry-run/apply/repeat，正式full永久不重跑。

v0.6.62版本/治理直接safe m38+m81已`57/57 PASS`（16+41），source/snapshot`dc4cd489…43f1`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full永久不重跑。下一步在正式restore的新工作副本执行dry-run/apply/repeat，再做精确diff/hash与完整增量Review。

v0.6.62最低未占用身份已确认并从`origin/main@fe93d835…b8d3f`建立隔离分支。冻结生产副本只读证明Grok3.5 row与active immutable revision同为精确旧形状：用户字段、角色、数量及v1 specialized runtime identity不变，只缺`inputPolicy.promptPolicy`且旧revision未持久化`referencePolicy`。代码只允许row+active exact legacy、proposed exact current、v1完整identity逐字等价的升级证明；row/active near-miss或非该模型滥用均阻断。TypeScript/diff-check通过，safe m102 `24/24 PASS`（source/snapshot`474120c1…099`、库存1125、异常0、4173 unchanged）。下一步safe m81+m38、主线程逐链Review、冻结与独立终审；正式full永久不重跑。

v0.6.61隔离工作副本`v0.6.61-contract-upgrade.Tupzga`的dry-run在apply前对真实`grok-imagine-video-1.5-preview`报`Model input prompt policy cannot weaken this Provider model`并准确停止；工作/生产DB SHA均为`13589eea…2261`且生产未写。v0.6.61不可变且未部署，生产恢复v0.6.57健康。下一修正版必须递增到最低未占用v0.6.62，只接受生产精确legacy Grok3.5 prompt/input合同；任意near-miss与其他模型漂移继续fail-closed，先补m102 exact/near-miss，再执行版本门与完整增量Review。

v0.6.61正式冻结目录=`/var/lib/unboundry-rollbacks/v0.6.61-cutover-frozen.q9k50E`：source/restore各366文件，双清单`a758e801…aea2b`，DB`13589eea…2261`，Library`444e64f4…80f49`；schema41、quick/integrity、FK0、tasks1025/attempts1036/active0/unknown0、media949/1772056577、canvas76、models20/10、templates50/48、Library2完全一致。首个清单引号失败目录`v0.6.61-cutover-frozen.LRLTxA`保留且生产数据未写。服务保持inactive/enabled；下一步仅从正式restore复制唯一迁移工作副本并先dry-run。

v0.6.61生产quiet gate连续7次`active=0/unsettledUnknown=0`，current/API始终v0.6.57，service active/running、NRestarts0。首个诊断曾把10条已finished的历史unknown误计入未收口口径；只读分布核对后确认9 failed+1 cancelled且均已结束。该quiet门已闭合。

v0.6.61精确tag archive SHA=`70be072c9ea41891fe63f8b793775598307aa49055cb2b6972f94f6b8fdb1a22`，远端逐字校验一致；服务器独立staging=`/opt/unboundry/staging/v0.6.61-inc-gen-017-20260830.Dnplbk`固定Node22.23.2/npm10.9.8完成npm ci、TypeScript、Vite build、6035行inventory与dist33验证，inventory SHA=`3efd2f7e6eb49b7f829257f484051ae610098b6f9a66f0e80101bfb0719f4600`。该fresh-build门已闭合；生产仍v0.6.57/schema41、Provider POST=0/USD0。

PR #130最终head`36fabed`与main Quality gates均通过，merge=`fe93d8359a5a3ee5f8bfe1d64f494ec87d4b8d3f`；annotated tag object=`19919318199d6e6b495853ce331c5aa4c00814fd`精确指向merge，GitHub Release v0.6.61已发布。首次tag探测TLS失败未改变远端，随后push/verify成功；该阶段身份门已闭合。

PR #130 head`31c4737`的Quality gates已通过（run`33303385616`/job`99235504319`，29秒）。只回写并推送本条CI证据；最终纯文档head同一门通过后才合并。

v0.6.61分支已推送，PR #130 base/head=`main@b5867b3`/`dc64f08`且mergeable。当前检查尚未启动；回写本条纯文档head后等待同一Quality gates通过，再合并与冻结tag。

v0.6.61实时GitHub身份门通过：`origin/main@b5867b3`未前进，v0.6.61本地/远端tag与Release均未占用，同head PR不存在；当前PR差异为14个预期文件、515 insertions/26 deletions且无受保护JSON。提交本治理回执后推送并创建PR，最终head CI通过前不合并。

v0.6.61候选提交后治理safe m38为`16/16 PASS`，source/snapshot`60754094…14297`、库存1125、异常0、HEAD`7733464…a45423`、4173 unchanged。当前只提交六份治理回执，再刷新远端身份并进入push/PR/CI；正式full永久不重跑。

v0.6.61冻结8文件候选已精确提交为`7733464cc997053a5a66c2882a9858d570a45423`，tree`692f11eae5d6ea4cb76aad40162d35fed1ab9371`，337 insertions/12 deletions；治理文档和受保护JSON未提交。当前只运行提交后治理m38，再独立提交六份治理回执并进入push/PR/CI。

v0.6.61 Review GO治理safe m38已`16/16 PASS`，失败/重试/跳过/reportErrors0、库存1125、source/snapshot`b5a903f8…d150`、4173 unchanged。runner已成功完成并清理；其后外层zsh包装因只读变量名`status`返回1，未改变测试结论且不重复运行。当前只精确提交冻结8文件候选，六份治理回执另行收口。

v0.6.61第三候选同一独立审查上下文已对冻结HEAD `7f2f8d4…05d0`与diff hash `8e1a52ea…32ae8`完成只读终审：8/8文件、30/30 hunks、337 insertions/12 deletions，覆盖完整普通发布/回滚、迁移/schema/template/CAS/activation/audit/repeat链、10/10 logical models、11/11 exact identities及全部adapter分支；最终`P0=0/P1=0/P2=0/GO`。审查未写文件、未测试/build、未联网、未触发Git/Provider/OSS/生产且未读取受保护JSON。当前只运行Review GO治理m38；通过后才可精确提交冻结8文件候选。

v0.6.61第三候选主线程全量增量Review已覆盖8/8文件、30/30 hunks、完整migration/schema/template/普通发布/事务/CAS/immutable revision/repeat链、10/10 published logical models、11/11 exact identities与全部Provider/protocol/adapter分支，结论`P0=0/P1=0/P2=0/GO`。候选337 insertions/12 deletions、diff-check通过，精确hash`8e1a52ea…32ae8`并冻结；只允许同一独立上下文只读终审，独立GO前不commit、不进入GitHub/生产/真实Provider。

v0.6.61别名整改最终治理门已闭合：六份治理同步后safe m38 `16/16 PASS`，source/snapshot`2b3f2b69…5376f`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged，取代此前`769a79cf…a32f`。当前只做精确diff/hash与主线程全量增量Review；正式full永久不重跑。

v0.6.61 OpenRouter exact alias残余P1已关闭：当前普通发布策略同时识别relay `gpt-image-2/gpt-image`和OpenRouter `openai/gpt-image-2/native`，按各自driver/schema生成registry-owned expected document，并对connector/version、runtime、evidence与完整execution contract做激活前逐字校验。m102证明两个exact identity均可validate+publish，且evidence、受支持的version-bumped connector与create path漂移均fail-closed；强化反例首轮`23/24`只因fixture先命中既有unsupported runtime version门，改为受支持组合后最终`24/24 PASS`（source/snapshot`0eced929…50636`、库存1125、异常0、4173 unchanged）。TypeScript/diff-check通过；下一步治理m38、精确diff/hash与主线程复核。

v0.6.61第二候选独立复核为`P0=0/P1=1/P2=0/NO-GO`：relay主GPT身份已关闭，但同一logical model的OpenRouter exact identity `openrouter/openai/gpt-image-2/native`未进入普通发布exact policy，version-bumped connector/contract漂移仍可激活。候选再次解冻；整改只把该第11个identity纳入同一代码拥有合同并补m102别名回归，复核GO前不进入commit、GitHub、生产或真实Provider。

v0.6.61整改后主线程复核新增普通发布策略门及原完整范围，结论`P0=0/P1=0/P2=0/GO`；第二候选8文件、30 hunks、285 insertions/12 deletions、diff-check通过，精确hash`6ff60ec5…c2d71`并冻结。当前只允许同一独立上下文只读增量终审，复核GO前不进入commit、GitHub、生产或真实Provider。

v0.6.61独立终审P1已关闭：普通合同策略对GPT Image 2逐字约束image/gpt-image身份、connector/version、runtime、EXACT evidence与完整专用执行合同，并把evidence纳入transition runtime signature；错误revision不能被激活。TypeScript/diff-check通过，safe m102新增三类漂移回归最终`24/24 PASS`（source/snapshot`bb4d4df1…0bd60`、库存1125、异常0、4173 unchanged）；首轮`23/24`只是测试错误文案过窄。下一步重新冻结精确hash并交同一独立上下文只读复核。

v0.6.61独立只读终审覆盖8/8文件、25/25 hunks、完整迁移/普通发布/事务/CAS/幂等链和10/10 models、11/11 identities后给出`P0=0/P1=1/P2=0/NO-GO`，候选解冻。P1是普通合同发布路径未将GPT Image 2 exact registry的runtime/connector/evidence/执行合同作为发布前硬门，允许仅把`evidence`从`EXACT`改为`SPECIALIZED`后激活错误revision。整改只收口普通draft/validate/publish共用校验与transition identity并补精确回归；复核GO前不进入commit、GitHub、生产或真实Provider。

v0.6.61主线程增量全量Review已覆盖8/8文件、25/25 hunks、完整迁移/schema/模板/事务/CAS/immutable revision/重复幂等链、10/10 published logical models、11/11 exact identities与全部Provider/protocol/adapter分支，结论`P0=0/P1=0/P2=0/GO`。候选216 insertions/11 deletions、diff-check通过，精确hash`017c3b94…6a5ea`并已冻结；只允许独立只读增量终审，独立`P0/P1=0/GO`前不进入commit、GitHub、生产或真实Provider。

v0.6.61最终m102增量门在增加“非GPT模型不得滥用`exact-legacy-gpt-image-2-v1`同版本证明”反例后仍为`24/24 PASS`，source/snapshot`da861c1d…a34c6`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；该结果是当前m102权威证据。Provider POST=0/USD0，正式full永久不重跑；下一步精确diff/hash与主线程逐链复核。

v0.6.61版本/治理直接safe m38+m81现为`57/57 PASS`（16+41），source/snapshot`c70e4e46…5699`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full永久不重跑。当前只做精确diff/hash与主线程逐链复核，随后冻结候选并启动独立增量全量Review；Review GO前不进入GitHub或生产。

v0.6.61精确legacy GPT Image 2迁移已完成第一道直接门：仅当default row与active immutable revision都精确匹配生产旧schema、proposed精确匹配current schema、execution contract保持v1且完整runtime identity逐字等价时，才允许字面证明`exact-legacy-gpt-image-2-v1`完成同版本schema补全；row/active任一near-miss或身份/contract变化均阻断。package/lock/runtime/m81同步0.6.61；TypeScript、diff-check与safe m102 `24/24 PASS`（source/snapshot`73797359…5327`、库存1125、异常0、4173 unchanged）。下一步只跑safe m81+m38；正式full永久不重跑。

v0.6.60身份门与首个直接回归已完成：`origin/main@e6341d5`未前进，本地/远端tag和GitHub Release均未占用；package/lock/runtime/m81同步。真实旧Grok的精确特征为inputMode text/image/reference、referenceInputs全0、空media rules、无referencePolicy及旧三角色input policy。迁移现在只对这一精确快照收敛到当前窄合同；模板兼容桥只在该精确旧schema启用，并继续逐节点比较immutable execution contract。near-miss额外mode阻断。safe m102首轮`23/24`暴露22模板通用字段diff，最小修复后最终`24/24 PASS`（source/snapshot`25f82ecd…e51a2`），库存1125、异常0、4173 unchanged。

v0.6.60版本/治理直接safe m38+m81为`57/57 PASS`（16+41），source/snapshot`07053ab1676727c20dc68150c1dbfb61bebb0ca982f23a1ccef31da3914490b8`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full永久不重跑。下一步只做精确diff-check、冻结6文件候选和独立增量Review，P0/P1清零前不进入GitHub或生产。

v0.6.60的6文件候选已按精确diff hash `f4489901f1fa32da576e9a71c0e9ad66434c32c0a9998ec7f3a490a35e222643`冻结，共156 insertions/17 deletions且diff-check通过。独立Review必须覆盖6/6文件、全部diff/hunk、完整migration plan→target document→template compatibility→transaction apply→repeat idempotence链，以及10/10 published logical models和11/11 exact identities；Review GO前不提交、不推送、不触及生产。

主线程终审已把该候选退回为`P0=0/P1=1/NO-GO`：真实Grok active immutable execution contract为v2，而测试夹具错误固定v1；现有semantic-change版本门会在真实schema narrowing时直接阻断。整改只允许row默认schema与active revision schema都精确匹配已核准legacy、且active/target execution contract完全相同的v2 capability-schema收窄；任何active near-miss、执行合同变化或其他模型仍fail-closed。修复后只重跑m102并重新冻结/终审。

该P1现已按窄证明关闭：row/active schema必须同为exact legacy或同为current，`other`/不一致均阻断；v2同版本例外要求row+active exact legacy、proposed exact current及model/capability/connector/profile/protocol/runtime/evidence/execution contract全部相同。迁移upgrade API在事务内复核revision后才传字面证明`exact-legacy-grok-video-3-v2`，底层发布策略再独立验证predecessor/proposed exact schema、Grok3、v2/v2和runtime signature；普通发布、非Grok及其他Grok schema变化仍不能绕过版本提升。m102真实v2、row/active near-miss、事务apply、重复幂等和证明滥用阻断最终`24/24 PASS`（source/snapshot`fbb527b7…81ca4`），库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；两次`23/24`及中间绿色`630b67aa…0357e`、`62026696…40836a3`诊断均保留。下一步复核扩展后的8文件候选并重新冻结。

当前树六份治理同步后的safe m38为`16/16 PASS`，source/snapshot=`df49cb21808262d3c56ae257232d81af1ac67ff5f7a073f320b32dcb5f105c10`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；前一树`3236e2bf…72dd3`只保留历史。当前8文件产品/版本/测试diff为308 insertions/27 deletions，精确hash`79252797…d45a5`且diff-check通过；下一步完成主线程逐链复核、冻结与独立增量终审。

主线程全量增量Review已覆盖8/8文件、全部diff/hunk、完整迁移/模板/事务/CAS/幂等链、10/10 published logical models、11/11 exact identities及所有Provider/protocol/adapter分支，结论`P0=0/P1=0/P2=0/GO`。8文件候选以`79252797…d45a5`正式冻结；独立审查上下文给出`P0/P1=0/GO`前不提交、不推送、不迁移生产、不触发真实Provider。

独立只读增量终审已覆盖8/8文件、31/31 hunks、10/10 logical models、11/11 exact identities、全部Provider/protocol/adapter分支及完整migration→template→transaction/CAS→immutable revision→repeat链，最终`P0=0/P1=0/P2=0/GO`。旧v2/active schema P1与near-miss/证明滥用/CAS边界全部确认关闭；未运行测试/build或任何外部写，受保护JSON未读取。当前只运行Review GO治理m38，然后精确提交冻结8文件候选。

Review GO后的治理safe m38为`16/16 PASS`，source/snapshot=`3811d4a83a62802d10581bbeb3d1b2b306bfc6ddb423bf4cc0decbc218418a66`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full永久不重跑。下一步只提交冻结8文件产品/版本/测试候选，六份治理回执独立收口。

冻结8文件候选已精确提交为`8be339c387ec9df21e4e6e6ee43da2f14e2ee8dc`，tree=`8179a5540fecd2b920154bb059c788080a0374a4`，308 insertions/27 deletions；治理文档与受保护JSON均未进入commit。当前运行提交后治理m38，再独立提交六份治理回执。

候选提交后治理safe m38为`16/16 PASS`，source/snapshot=`fdfbe741ebb004c9d4dc8a740d2ce4217efd94d7ae9f57eabe83f2a2a108d1d0`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full不重跑。当前只提交六份治理回执，再进入push/PR/CI。

两个commit已推送，PR #129 base/head=`main@e6341d5`/`7f34d09`且mergeable；Quality gates / lightweight run`33298263718`、job`99221554337`以35秒通过。当前只提交并推送本条CI治理回执，等待最终纯文档head同一门通过后再合并。

PR #129最终head`76fd686`的Quality gates run`33298346157`/job`99221773974`以30秒通过并merge为`b5867b3edf8f39c9a58b4e77d9060e1567dd9de2`；main run`33298393397`/job`99221893013`以27秒通过。annotated tag object`c54cf6d107dd891d0ac689b5bd313845e5dd3e72`精确指向merge，GitHub Release v0.6.60已发布。当前进入精确tag fresh build、quiet gate、冻结备份与隔离迁移。

v0.6.60精确tag archive SHA为`8db3ed0f921a64187b2cdca7ae7c7ae6fcf7e9b2c48f6c0ee3fc3b1659790b03`并解引用到merge`b5867b3`；服务器新建独立staging`/opt/unboundry/staging/v0.6.60-inc-gen-017-20260830.dA88ys`，固定Node22.23.2/npm10.9.8完成npm ci、TypeScript、Vite build和inventory验证。清单6035文件、SHA`d14ed3db…b6c8`、dist33；生产仍为v0.6.57/schema41，Provider POST/费用0。下一步只执行quiet gate，再停服冻结备份和隔离迁移。

v0.6.60生产quiet gate连续7次均为active0/unsettledUnknown0；current/version仍为v0.6.57，service active/running、NRestarts0。下一步严格先停服并建立新的冻结source/restore双副本、清单和数据库基线，再仅对恢复副本执行迁移；任何失败立即恢复v0.6.57并保留全部证据。

停服后的正式冻结目录为`/var/lib/unboundry-rollbacks/v0.6.60-cutover-frozen.k3xebQ`：source/restore各366文件，双清单SHA`a758e801…aea2b`，DB SHA`13589eea…2261`；schema41、quick/integrity ok、FK0、tasks1025/attempts1036/active0/unknown0、media949/1772056577 bytes、canvas76、models20/published10、templates50/published48及Library门在两副本一致。首个清单引号失败目录`v0.6.60-cutover-frozen.in7NN7`保留且生产数据未写。服务保持inactive/enabled；下一步仅从restore-copy再建唯一迁移工作副本，先dry-run，再apply与repeat幂等。

v0.6.60隔离工作副本`v0.6.60-contract-upgrade.Ym2zSJ`的dry-run在apply前对真实`gpt-image-2`旧合同报缺少reference media rules并准确停止；工作DB SHA未变，生产DB未写，失败证据`5f68f8a7…7f6d0`与全部目录保留。生产已恢复v0.6.57健康，v0.6.60不可变且未部署。下一修正版必须递增到最低未占用v0.6.61，只接受生产精确legacy GPT Image 2 schema并补exact/near-miss回归；不得修改v0.6.60 tag或放宽其他relay/image合同。

v0.6.59精确tag archive `63042cff…71b8`的服务器fresh build与7次quiet gate均通过；冻结备份`v0.6.59-cutover-frozen.jufZ1z`双副本366/366、清单`39c9e691…ebf3`、DB`13589eea…2261`、schema41/integrity/FK/计数门有效。隔离迁移副本`v0.6.59-contract-upgrade.Nz9OFg`在apply前对真实published `grok-video-3`旧schema报`Invalid model reference policy`并fail-closed，生产未写且继续v0.6.57健康。v0.6.59 Release不可变、未部署；当前递增到最低未占用v0.6.60，只允许精确匹配真实legacy Grok schema的受控迁移，任意near-miss继续阻断。先补m102 exact/near-miss，再跑m102+m81+m38、独立增量Review和新PR/tag/fresh build；正式full永久不重跑，Provider POST/费用仍为0。

R8生产浏览器在Provider POST前发现旧published schema缺少当前语义合同元数据，v0.6.57按设计fail-closed，真实POST/费用仍为0。整改后plan与事务内activation均核对完整model/provider/protocol identity和runtime/connector/evidence/totality；Seedance、Gemini、Mureka fixture恢复精确协议/driver，并增加错协议、错driver、缺参数阻断。冻结diff `dcf8a42d…3cb854`的独立增量终审覆盖8/8文件、10/10 logical models、11/11 exact identities，最终`P0=0/P1=0/P2=0/GO`；m102 `24/24 PASS`（`e93a5baf…610032`），库存1125、4173 unchanged。现按硬门进入v0.6.58准备，再依次执行GitHub、生产迁移和真实Provider。

v0.6.58身份门已确认：`origin/main@b34a6f454608da2244f87ca0fffb8e8ef6704050`未前进，本地/远端tag与GitHub Release均未占用；package/lock、final runtime allowlist和m81断言已同步。生产仍为v0.6.57/schema41，m81+m38版本定向门通过前不提交或推送。

版本直接门最终有效`57/57 PASS`：m81 `41/41`首轮通过，m38修正唯一治理版本字段后`16/16 PASS`（`30e11dbd…c7d7b`）；库存1125、异常0、4173 unchanged。正式full不重跑，当前只执行提交前最终治理m38和diff-check。

提交前最终治理safe m38现为`16/16 PASS`，source/snapshot`79ae8703792cb1f730ea723b3bee2102f86936dd504a32c6ed7189b2dc609cd6`、库存1125、异常0、4173 unchanged；精确diff-check通过。迟到的`b577…`终审回执属于已记录并关闭的早期候选，不覆盖当前`dcf8…`热修Review GO；随后仅回写本条证据，按硬门进入精确安全提交。

v0.6.58功能/版本候选commit已冻结为`760dfcf131d5800f8e03e8533199ef1e773a7ea3`，tree`dc8c192e27acf6373899a959e9cc0d4a22f86e3e`，18个安全文件且两个受保护JSON未进入提交。按阶段只回写治理、运行提交后m38并提交六份回执，再进入push/PR/CI。

候选提交后治理safe m38为`16/16 PASS`，source/snapshot`1b906cf7b8e8dd64e9a016a28c1219168407f1a89643bbfef3fd33d722968f79`、库存1125、异常0、4173 unchanged；随后仅回写该回执，六份治理文件可独立提交并进入push/PR/CI。

PR #127已创建且base/head为`main@b34a6f4`/`0226d77`、mergeable；Quality gates / lightweight run`33273711037`、job`99156654353`以31秒通过。本轮只回写该CI证据并推送最终纯文档head；必须等待新head同一门通过后才合并与冻结tag。

PR #127最终head`1441e2b`与main Quality gates均通过，merge commit`730ea56`已由annotated tag/GitHub Release `v0.6.58`不可变标记。tag object`959dbc9`，archive SHA`85cfe65e…ffe5b`；服务器fresh build固定Node22.23.2/npm10.9.8，6035文件、inventory`37b52e73…16bb8`、dist33且TypeScript/Vite/inventory全绿。生产仍为v0.6.57/schema41；进入quiet gate、冻结备份与恢复副本合同迁移。

v0.6.58在真实冻结恢复副本dry-run发现未被fixture覆盖的Mureka旧schema：lyrics 8000与outputCount 1/2/3无法通过当前单结果合同。迁移在apply和生产替换前准确停止；冻结备份`v0.6.58-cutover-frozen.ZXQMnx`双副本与清单有效，失败迁移目录`v0.6.58-contract-upgrade.cTADN5`保留，生产恢复v0.6.57健康，Provider POST/费用0。v0.6.58保持不可变且未部署。实时源码与既有m17证明lyrics运行时上限为8000，本热修不改歌词能力，只收敛outputCount。

修正版递增为最低未占用v0.6.59。只允许精确匹配生产legacy Mureka schema的受控收敛，并把Mureka列入核准semantic revision发布集合；错字段、错选项或其他任意漂移仍阻断且错误携带providerModelId。先补m102生产旧schema/畸形反例，再跑m102+m81+m38最小门、独立增量Review与新PR/tag/fresh build；正式full永久不重跑。

v0.6.59迁移直接证据：safe m102最终`24/24 PASS`，source/snapshot`c00a705d28e55b429d1b7ab952af61f0411fb4c0cbcd31cd465aef92c14ed955`、库存1125、异常0、4173 unchanged。精确legacy 8000+1/2/3只迁移到8000+1，畸形1/4阻断，apply后重复计划/执行幂等；mureka-native contract v2仅用于读取新semantic revision，旧v1继续支持。前置诊断均在同一spec内收口，未触发Provider/OSS/生产。

版本/治理直接门m38+m81随后`57/57 PASS`，source/snapshot`6848e45bd391cf15cbce4c7cc872731be8042088e95b19bbe558f158eda3ff3f`、库存1125、异常0、4173 unchanged。7文件产品/版本/测试diff hash为`d58b6101…d702`且diff-check通过；v0.6.59候选冻结后只做独立增量Review，P0/P1=0/GO前不进入GitHub或生产。

v0.6.59独立增量Review已覆盖7/7允许文件、14/14 diff hunks、完整迁移/身份/runtime/事务/幂等链、10/10 published logical models和11/11 exact identities，最终`P0=0/P1=0/P2=0/GO`。首轮把Git历史默认lyrics 5000误作生产迁移输入的P1，已由当前生产、冻结source与restore三份只读DB证据裁决：三份SHA256均为`54468f…12aded`，published Mureka实际均为lyrics 8000与outputCount 1/2/3；因此候选的exact legacy 8000比较和m102夹具与真实生产一致，P1撤销。Review未运行测试/build或外部写，受保护JSON未读取；现进入治理m38与精确提交。

Review GO后的治理safe m38为`16/16 PASS`，source/snapshot`0cce774d…799a`、库存1125、异常0、4173 unchanged，且diff-check通过；唯一正式full未重跑。现按精确pathspec只提交7个产品/版本/测试文件，治理文档另行收口。

v0.6.59产品/版本候选commit已冻结为`6abe72b72b496de08a7309948b3b3ee06df54652`，tree`25b4a00d19cead0a5ef8080e89db6795543654aa`，精确包含7个已终审文件；六份治理文档与两份受保护JSON未提交。按阶段运行提交后m38，再独立提交治理回执并进入push/PR/CI。

提交后治理safe m38现为`16/16 PASS`，source/snapshot`25c7a168…7bf9e`、库存1125、异常0、4173 unchanged；正式full未重跑。现只提交六份治理回执，之后push/PR/CI。

分支已推送并创建PR #128，base=`main@730ea56`、head=`61f5b2b`。首次push仅遇TLS握手瞬态失败且远端未变，原分支重试成功；当前提交并推送本条治理回执，只有最终head Quality gates通过后才合并。

PR #128治理head`f575836`的Quality gates / lightweight已通过（run`33295091931`、job`99213263004`，48秒）。本轮只回写该CI证据并推送，等待最终纯文档head同一门通过后再合并。

PR #128最终head`944ae9b`与main Quality gates均通过，merge commit`e6341d5`已由annotated tag/GitHub Release `v0.6.59`不可变标记。tag object`52308b6`精确解引用到merge；进入tag archive SHA、服务器fresh build、quiet gate与冻结恢复副本迁移。

实施回写：最新用户已显式发送一次性`/goal`并授权R0～R8。唯一正式safe full已永久消费，原始结果`1023 PASS / 95 FAIL / 4 NOT_RUN`且不得改写或重跑。原始27个失败spec与m29/m65四项未运行用例现已全部由最小失败spec执行闭合；最后m73 `16/16`、m77 `11/11`，合计`27/27 PASS`，source/snapshot`720b0ea6f77968e663b2db426a30fe376184a8aec7f3cbebac8c81d462a9499c`，异常0、4173 unchanged。失败映射P1已关闭；当前只允许同步治理、运行治理m38并重新冻结候选做独立只读增量终审。Provider POST/费用与生产/OSS写仍为0；重新终审`P0/P1=0/GO`前不得进入R7、GitHub、版本或生产。

增量终审登记的3项P2已在失败映射阶段关闭：字段级三方CAS避免adoption回滚覆盖并发几何/UI，上传开始态以带checkpoint的durable adoption保证保存失败无`uploading`残留并串行化替换，TASKS状态标题已同步。safe m37最终`38/38 PASS`、库存1124、source/snapshot`de0d967a…8b4`、异常0、4173 unchanged，TypeScript通过。该证据不关闭95 FAIL/4 NOT_RUN的P1；下一步仍只运行未覆盖的17个原失败spec，禁止重跑full。

六份治理同步后safe m38 `16/16 PASS`、库存1124、source/snapshot`bce62952…c61e`、异常0、4173 unchanged。治理门已闭合，现只执行17个原失败spec的单次最小集合；失败时只重跑失败spec。

失败映射最终闭合：27个原失败spec全部有当前树最小绿色证据，95 FAIL与4 NOT_RUN均已映射；m65 `3/3`关闭原2项NOT_RUN，m29 serial后续亦已执行通过。最后两spec先以`25/27`诊断精确fixture漂移，再只修fixture后为`27/27 PASS`，source/snapshot`720b0ea6…a9499c`。正式full原始失败事实保持，禁止用第二次full替代证据；当前进入治理m38与候选重新冻结。

治理safe m38现为`16/16 PASS`，库存1124、source/snapshot`7246af43…45b11`、异常0、4173 unchanged。整改产品/测试候选已按`720b0ea6…a9499c`冻结，之后只允许独立只读增量终审；Review GO前不进入R7或发布/Provider步骤。

独立增量终审现已完整覆盖96/96个安全范围改动文件（产品/类型60、测试36）及六份治理文档，全部diff/hunk、关键分支、相关调用链、published模型和Provider分支均已复核，结论`P0=0/P1=0/P2=1/GO`。唯一P2为legacy terminal路径未显式携带cache corruption信号；该路径零新task/零新Provider POST且仍有admission/scope/fresh-match围栏，按硬门登记后不阻断R7。下一阶段执行R7隔离浏览器验收，正式full继续禁止重跑。

R7隔离浏览器验收已以组合证据闭合：m22 `44/44`覆盖真实规模三组、组间隔离、失败/停止/刷新自动续作与零重复task；m68 `4/4`覆盖任务面板和兄弟组恢复；m30最终`13/13`覆盖Seedance遗留首帧角色到`multimodal/reference-image`的确定性原子迁移与执行期admission。有效合计`61/61 PASS`，最终m30 source/snapshot`5fc0da230b57194741a8e71f0b33916e9fcfbe39d8a62181db619fff237f8d35`，异常0、4173 unchanged。首轮`60/61`唯一失败为旧测试源码断言，产品上传门实际更严格；只对齐断言后通过。该证据不冒充单一monolithic fixture，按`R7_COMPOSITE_BROWSER_TARGETED_PASS`进入R8准备；Provider POST/费用、OSS/生产/真实数据写0。

R7治理回写后的safe m38为`16/16 PASS`，source/snapshot`26bbf3a8d3c29be3ee4c6284450c1f2009042cb1144ec689597dfd622c8482c3`、库存1124、异常0、4173 unchanged；R8只在重新核验版本、GitHub/CI、生产回滚与USD100预算硬门后执行。

R8选择最低未占用补丁`v0.6.57`：实时`origin/main`未前进，远端tag与GitHub Release均不存在；package/lock、final runtime版本门及m81断言已同步。生产仍为v0.6.56/schema41，版本直接相关safe m81+m38通过前不提交或推送。

版本直接相关safe m38+m81现为`57/57 PASS`，source/snapshot`2e0c5feefe96aab8a3b80aef14e428be70fa1c9260266a5ca210818f6c50c3a5`、库存1124、异常0、4173 unchanged；TypeScript和diff-check通过。同步治理并跑候选提交前最终m38后进入Git提交。

候选提交前最终治理m38 `16/16 PASS`，source/snapshot`d82e354540eb9c893a615840060ffed5a227807472a6972ffd4eb35e1a1b945b`、库存1124、异常0、4173 unchanged；候选现可提交，正式full继续不重跑。

v0.6.57功能候选commit为`46a9abf110e55dd14d9519228c708759224d8c78`，tree`43825c5ef8601e3e55d8bced9ca9c48317f9a4c7`；两份受保护JSON未进入提交。治理收口m38与治理commit后进入GitHub/CI。

功能候选提交后的治理safe m38为`16/16 PASS`，source/snapshot`a52ff92ca31444b753955fe5f21986fcddefba5bac29bb1a71aa8fbb4b892527`、库存1124、失败/重试/跳过/reportErrors0、4173 unchanged。六份治理文档现可单独提交；随后push/PR/CI，正式full继续永久禁止重跑。

治理commit`0941fc5`已推送，PR #126已创建且base/head身份与候选一致；GitHub Quality gates正在运行。CI通过后按授权合并到main，再对精确merge commit建立不可变v0.6.57 tag/Release。

PR #126 head`d153b61`的Quality gates已通过（run`33269246033`/job`99144636759`）。只回写CI证据后等待最终文档head检查，再合并main并冻结v0.6.57身份。

PR #126最终head与main Quality gates均通过，merge commit`b34a6f4`已由注释tag/GitHub Release v0.6.57不可变标记。精确tag fresh build在Node22.23.2/npm10.9.8通过，inventory 6035文件/`321256ab…c7581`、dist 33；冻结备份`v0.6.57-cutover-frozen.bFZKEN`双副本366/366文件且清单同SHA`73ac36da…835d`，schema41/integrity/FK和计数一致，standby恢复演练通过。

生产已切到`/opt/unboundry/releases/v0.6.57-inc-gen-017-20260830`，v0.6.56回滚和v0.6.57前向切换、回环/公网健康、33/33静态字节、数据不变和72秒稳定门均通过；service active/enabled、NRestarts0、journal warning0。当前只剩USD100内最小真实Provider验收与最终治理回执；unknown禁止第二POST。

生产技术回写治理m38在修正既有单一版本治理标记后最终`16/16 PASS`，source/snapshot`7aac68cc…833af`、库存1124、异常0、4173 unchanged；正式full未重复。

### R6 第四轮整改与第五候选准备回写（2026-08-29）

- 第四轮7项P1全部实施关闭：四类standalone恢复、unknown adoption、workflow accepted/terminal统一使用完整input/ownership/contract/release/workflow identity；checkpoint/lease的精确key、混合损坏、导航、写/清与项目删除全入口fail-closed；Doubao TTS ownership仅由服务端实际提交参数计算。
- 同局部4项P2完成：Mureka/OpenRouter单结果响应强校验、image-tool graph operation receipt CAS；模型迁移保留历史task/result身份并由新contract/release围栏隔离，禁止旧任务误投影。
- 最小受影响证据：safe m40 `15/15`、m22 `44/44`、m15 `7/7`、m26 `10/10`、m100 `13/13 PASS`；库存1108，失败/重试/跳过/报告异常0，TypeScript与diff-check通过，最近产品+测试source/snapshot`b62f7f294c6f6a8d6e82f39e103e0f0d16e4b6e3f3a3ce39fe55542c54e4b05d`，4173 unchanged。m22新增fixture补齐contract；双页race的5秒等待波动通过页面重载与15秒有界等待稳定，不改变产品语义。
- 五份治理文档同步后safe m38 `16/16 PASS`，source/snapshot`479ce3bbcb6acef230c43d7e291f780e9e67c00a4d17bd3208b3365de9278c87`，异常0、4173 unchanged；第五候选现已冻结。原两个审查上下文必须继续完整只读复核，模型审查不得再读取受保护R0 JSON。第五轮`P0/P1=0/GO`前仍禁止唯一正式full、GitHub、版本、生产和真实Provider。
- 第五候选主线程只读复核立即发现`P1=1/NO-GO`：合法存储前缀后的malformed JSON key被`parseScopedStorageKey`静默视为无关项，cache/navigation/delete/admission可能fail-open。候选已解冻；最小修复是任何此前缀key的解析失败都标记corrupted，并用m22覆盖checkpoint与lease两种key且断言零变更/fail-closed。
- 第五轮P1已按上述最小边界关闭：prefixed malformed checkpoint/lease key统一corrupted，准入/claim/navigation/write/delete共享fail-closed结果。safe m22 `44/44 PASS`，source/snapshot`dc8a12a173e1fd110683b86bb29c89ec7b64da7a7388f073b3dad742713d84f3`，库存1108、异常0、4173 unchanged；TypeScript/diff-check通过。治理m38随后`16/16 PASS`，source/snapshot`d1f4201a312c5f6980469268f8c388571fafdd2cdbb283eac5fddcbd644dfaf0`；第六候选已冻结待完整只读终审。
- 第六候选主线程同根复核发现合法JSON非数组/不完整scope key与空字符串value仍可静默跳过，`P0=0/P1=1/NO-GO`并解冻。修复必须把prefixed key结构校验置于scope比较前，把空value交给JSON解析并标记损坏，覆盖checkpoint/lease/cache/active/admission/navigation/delete全入口。
- 第六轮P1已按完整结构族关闭：prefixed key只有通过严格`3/4`段tuple、scope字段类型与非空runId校验后才可判为合法其他scope；非数组、不完整tuple和空value均进入corrupted门。safe m22 `44/44 PASS`，source/snapshot`c3b348fceb53ee3f0ac43070dd07dc6ec90e34c62ca0363b96302d49696618e4`，库存1108、异常0、4173 unchanged；TypeScript与diff-check通过。当前完成治理同步与m38后冻结第七候选，再由原两个审查上下文完整只读复核。
- 治理同步后的safe m38 `16/16 PASS`，source/snapshot`ab9d6008d0e0ced8060881991ebee79208de9ae66b2f8a48d3f4871b563d7994`，库存1108、异常0、4173 unchanged。第七候选已冻结并只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第七候选主线程终审发现新的同边界P1：损坏key/value被保留后，cache永远保持corrupted，权威重建结果也无法写回或取得lease，localStorage可永久阻塞正常生成。整改必须在服务端task+Canvas权威核验后安全修复/隔离当前scope缓存，并继续证明跨标签活动run不会被清除；不得把corruption简单忽略或直接进入新POST。
- 第七轮P1整改以authority-gated quarantine关闭：服务端task+Canvas binding完整重建是先决条件；Canvas admission Web Lock内再查询当前scope的held/pending run/claim locks并对原始localStorage字节做CAS，只把精确未变的损坏值加入当前页面内存隔离。原记录不删除，任一raw变化或同key写删立即撤销证明；quarantined scope每次自动/手动恢复仍重新查询服务端，无法查询Web Locks、存在跨标签活动run、CAS漂移或重建不完整均fail-closed且Provider POST=0。
- 当前树typecheck与diff-check通过。m22前两次均为`43/44 PASS`，唯一长链双页竞态预期一次首层POST实际零新增且零重复POST，checkpoint安全转为interrupted；增强失败诊断后的当前树为`44/44 PASS`、异常0、source/snapshot`72d76cd8873768ed103ac75d62e0d445b83c8bd62d724749484a11d4d5bd7f26`、库存1108、4173 unchanged。先完成治理m38再冻结第八候选；独立终审GO前仍禁止正式full/GitHub/生产/Provider。
- 六份治理文档同步后safe m38 `16/16 PASS`、异常0、source/snapshot`35ab0be5b03d2a94ddab648d3dfb3e5ecde9f9288ae9e0773c22a9dcdc3ce6b9`、库存1108、4173 unchanged；第八候选已冻结，只由原两个审查上下文完整只读终审。Review GO前仍禁止正式full/GitHub/生产/Provider。
- 第八候选主线程终审发现`P1=1/NO-GO`：corruption恢复先在Canvas admission外取服务端task/Canvas重建快照，再进锁做Web Lock/CAS隔离，存在跨标签受理/终态/崩溃TOCTOU；自动入口在foreign lock或query瞬态失败后又因scope once标记不再重启，手动入口会重复红错。整改必须让authority读取/重建、活动锁判断与raw CAS处于同一Canvas admission临界区，并在锁释放/瞬态失败后有界自动重试；所有可恢复提示继续走去重中性状态。
- 第八轮P1已关闭：三个corruption入口把服务端task+实时Canvas binding重建作为回调交给quarantine helper，由其在同一个Canvas admission锁内完成锁快照、损坏raw快照、authority读取和raw CAS；缺checkpoint的clean authority读取也在admission内。authority task ID基线随结果返回，最终lease admission拒绝基线后新出现的相关task，覆盖快速终态/崩溃TOCTOU。
- 自动恢复仅在authority/锁/写入瞬态失败时进入40×250ms有界等待，并由`storage`/lease事件再唤醒；稳定ref避免React依赖变化重新启动正常失败run。手动/Continue只发布一次中性恢复状态，不再把可恢复锁忙当重复红错。四次诊断性m22 `43/44`逐项暴露并关闭唤醒风暴、effect重启和历史task过度阻断；最终safe m22 `44/44 PASS`，source/snapshot`b5a8405ebfd7891501c7c0fdf3cf1ba376545c84c40e632cdf58512f2455666e`、库存1108、异常0、4173 unchanged，typecheck/diff-check通过。当前同步治理并运行m38，之后冻结第九候选；正式full/GitHub/生产/Provider仍禁止。
- 治理同步后的safe m38 `16/16 PASS`，source/snapshot`38e07c9b2ce7b7b6b7eccc13fa8c2e94f89d46fdd431f260f32f415954af4a9a`、库存1108、异常0、4173 unchanged；随后仅回写证据与冻结状态。第九候选已冻结，只交原两个审查上下文完整只读终审；正式full/GitHub/生产/Provider仍禁止。
- 第九候选主线程终审发现`P1=1/NO-GO`：自动恢复effect在既有扫描结束后只凭局部`awaitingAuthorityWake`决定是否响应`storage`/lease事件；之后手动/Continue因foreign admission lock失败时无法更新该局部状态，锁释放事件被忽略，恢复需要用户再次点击。候选已解冻并停止两路审查；最小整改为唤醒时同时读取实时cache，只要`awaitingAuthorityWake || cache.corrupted || cache.quarantined`即重新核对，同时保持clean普通run事件不触发恢复风暴。
- 第九轮P1已按上述边界关闭：事件唤醒实时读取cache，损坏/隔离状态即使不在原effect等待窗口也会重新进入40×250ms authority核对；clean普通run仍不会被重复唤醒。m22精确回归最终`44/44 PASS`，source/snapshot`8e9f759afac303bca5ef2037f1cb0c4e8c480e961410845c8f0cc17087d6e4c1`、库存1108、异常0、4173 unchanged；首轮唯一`43/44`是既有双页准入竞态15秒诊断，零新增/零重复POST且安全interrupted，未改代码的失败集复跑通过。typecheck/diff-check通过；当前治理同步与m38完成后冻结第十候选。
- 治理同步后的safe m38 `16/16 PASS`，source/snapshot`5a4d1c60d16b98afb3c78c74139e45b10cbaa842612f2d462df3a421b7e21758`、库存1108、异常0、4173 unchanged；随后仅回写证据与冻结状态。第十候选已冻结，只交原两个审查上下文完整只读终审；正式full/GitHub/生产/Provider仍禁止。
- 第十候选两路终审合并`P0=0/P1=6/P2=4/NO-GO`并已解冻。P1覆盖GPT Image 2同步专用route、clean/quarantine-empty recovery风暴、checkpoint key/payload scope、submission intent损坏与服务端同输入活动task门、standalone完整scope、snapshot/configurationRevision。P2覆盖本地终态通知去重、quarantine-only面板状态、连接校验pending nodes和极端lock-query唤醒。整改先关闭Provider/费用与幂等边界，再scope/snapshot，最后稳定空authority终止；只跑最小直接依赖并重新冻结。
- 第十轮整改已按上述顺序完成：GPT Image 2专用同步执行/单primary结果；损坏intent的完整identity服务端权威恢复与CAS；服务端同语义active task事务门；standalone完整scope；checkpoint scope与snapshot/configurationRevision；stable-empty authority、通知/面板、pending graph及有界lock-query唤醒。五个直接spec的有效最终证据为m102 `23/23`、m40 `17/17`、m5 `27/27`、m57 `16/16`、m22 `44/44 PASS`；库存1112、异常0、4173 unchanged，最近source/snapshot`2d8c36b0…28b7e`，typecheck/diff-check通过。两次测试前门失败与一次m22终态自唤醒诊断均已如实保留；Provider POST/费用、生产/OSS/真实数据写0。当前先同步治理并跑m38，随后冻结第十一候选交原两个上下文终审。
- 治理safe m38 `16/16 PASS`，source/snapshot`62da784db605c1c4b6a1be5b167aa129aa8707a1c69b56978d948d1a18123707`、库存1112、异常0、4173 unchanged；随后仅回写证据与冻结状态。第十一候选已冻结，只交原两个上下文完整只读终审；正式full/GitHub/生产/Provider仍禁止。
- 第十一候选两路终审合并为`P0=0/P1=5/P2=6/NO-GO`并已解冻。P1覆盖configurationRevision完整任务身份、损坏intent的版本化active-task收敛、standalone fixture scope、native Web Lock实际释放后事件顺序、OpenRouter同步图片post-boundary unknown。P2覆盖legacy revision字段、面板/批连接/通知直接证据、bootstrap skipped totality及Doubao Seed治理文字。按身份/幂等、lease、Provider unknown顺序整改，只跑最小直接依赖并重新冻结。
- 第十一轮5项P1与同局部6项P2已关闭：完整版本化generation identity贯穿所有任务路径；损坏intent与不完整历史active task fail-closed；standalone scope完整；native Web Lock真实释放后再通知；OpenRouter post-boundary不确定结果持久进入自动恢复；legacy revision、quarantine面板、批连接、通知/lock-query、bootstrap totality及Doubao Seed协议文字同步收口。当前直接证据为m22 `44/44`、m81 `41/41`、m88 `36/36`、m100+m31+m68 `28/28`及最终m5+m68+m1 `34/34 PASS`，库存1113、异常0、4173 unchanged，最近source/snapshot`fa23d0c1…4d38fc`；typecheck/diff-check通过，Provider POST/费用和生产/OSS写0。下一步仅为治理m38、冻结第十二候选并交原两个上下文完整终审。
- 治理m38两次`15/16`只暴露旧retry fixture缺完整expected identity与workflow binding configuration revision；补齐fixture后最终`16/16 PASS`，source/snapshot`d7f3cc93…e8fb4`、库存1113、异常0、4173 unchanged。随后仅回写证据和冻结标记；第十二候选已冻结，只交原两个审查上下文完整只读终审。
- 第十二候选模型/Provider全量终审为`P0=0/P1=0/P2=0/GO`，工作流全量终审为`P0=0/P1=3/P2=3/NO-GO`，合并后候选解冻。P1集中在standalone恢复缺configuration/fixture、unknown idempotency恢复未核fixture、任务面板与task-ID mutation未按fixture隔离；P2为stable-empty提示收口、无`locks.query`可用性和legacy terminal fixture hardening。按完整scope身份→恢复/mutation→UI状态顺序最小整改后重新冻结。
- 第十二轮P1/P2已按完整scope与generation identity关闭；定向复测进一步发现并关闭单节点prepare早于跨tab admission导致与整组lease互相退让的零提交空窗。单节点只在prepare/save/ensure/accepted binding持久化阶段持有Canvas admission，终态轮询不占锁。safe m100/m22/m40分别`13/13`、`44/44`、`17/17 PASS`，产品/测试source/snapshot`78c33729a982f8700c5715de5d2a6fa9943bf0605978fceaddc7049e70feaa27`；治理同步后m38 `16/16 PASS`、source/snapshot`30bf17b9…92563`。第十三候选已冻结，等待原两路完整只读终审；正式full仍未运行。
- 第十三候选两路完整只读终审合并为`P0=0/P1=5/P2=1/NO-GO`并已解冻。工作流侧发现Video execute-time transition仍在单节点admission外，以及accepted map未比较configuration revision；模型/Provider侧发现reconcile fixture scope、reconcile/usage Provider lease、Grok3 exact recovery contract、startup/sweep/auto-retry feature flag四项安全缺口。整改按费用/恢复身份优先，再Canvas admission原子性，最后防御性比较；完成最小直接回归后重新冻结，Review GO前不运行正式full或发布/Provider步骤。
- 第十三轮整改已完成：服务端reconcile/unknown/usage按fixture与Provider lease隔离，relay/Grok恢复使用任务冻结合同，startup/worker/sweep/launch/auto-retry统一受双止损开关约束；Video execute-time transition和fresh semantic identity重编译进入同一单节点Canvas admission，交互式切换及retained控件同步受锁；accepted task map补齐configuration revision比较。
- safe六spec首轮`108/111 PASS`，仅新测试marker与旧m5 fixture两类测试问题；只修失败测试后最终树m30 `12/12`、m5 `28/28 PASS`。m100/m102/m38/m57首轮已绿且之后无对应产品/测试改动，不重复执行。最终source/snapshot`e233a4b4c3ca796e87dad8afae2604ce4f14d83d573d42b6c9ea7723d133a27b`、库存1117、异常0、4173 unchanged，typecheck/diff-check通过，Provider POST/费用与生产/OSS写0。
- 当前先同步六份治理文档并运行治理m38，再冻结第十四候选交原两个审查上下文完整只读终审。该定向证据不是Review GO；`P0/P1=0/GO`前正式full、GitHub、版本、生产和真实Provider继续禁止。
- 治理safe m38最终`16/16 PASS`，source/snapshot`ca0efc1445c7e0e204dd8431db1c0bdbb31551a2427f9c13aa1d4131d4908c4b`、库存1117、异常0、4173 unchanged；其后只回写治理证据与冻结状态。第十四候选产品/测试树`e233a4b4…3a27b`现已冻结，只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十四候选完整只读终审合并为`P0=0/P1=3/P2=1/NO-GO`并已解冻：Video admission等待后的旧点击语义覆盖新Canvas；非Video节点与Canvas结构mutation可绕过foreign group lease；lease-only corruption缺authority quarantine；legacy recovery另缺fixture equality防御。模型/Provider路为`P0/P1/P2=0/GO`。整改按缓存自愈→全Canvas mutation admission→Video expected-before fence顺序完成并补直接竞态回归；复核GO前继续禁止正式full、GitHub、版本、生产和真实Provider。
- 第十四轮退回项现已按既定顺序关闭：checkpoint与lease corruption共同进入authority quarantine；legacy recovery核对fixture scope；所有节点语义修改与Canvas连线、切边、删除、模型迁移共用跨标签Canvas admission，foreign group lease与本页pending mutation均阻止控件写入；Video交互切换和生成点击携带点击时revision+目标语义fingerprint，锁内图变化时拒绝stale transition而保留最新Canvas。
- 最小直接证据为safe m22 `44/44`与m30 `13/13 PASS`，合计`57/57`，库存1118、异常0、source/snapshot`f45f84ce64f645f684ff56826bce1f94daf3dc7ba8314a0441b80bf1544bf568`、4173 unchanged；TypeScript和diff-check通过，Provider POST/费用及生产/OSS/真实数据写0。当前先同步六份治理文档并运行治理m38，再冻结第十五候选交原两个审查上下文完整只读终审；该状态不是Review GO。
- 治理safe m38为`16/16 PASS`，库存1118、异常0、source/snapshot`73587e3733722f1b5a1530a7ebb2ffeeaef158d4a913873a591587d386619beb`、4173 unchanged；随后只回写治理证据与冻结状态。第十五候选产品/测试树`f45f84ce…f568`已冻结，只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十五候选主线程终审发现`P1=1/NO-GO`并解冻：Text上游输入动作先发admitted node mutation，再同步发admitted edge mutation；前者立即占用pending node，后者必然被本页pending门拒绝，造成task/error已清而role/order/edge未变，且submission intent在admission前已撤销。最小整改为新增单次Canvas admission内的nodes+edges原子mutation端口，并只在成功后撤销intent；补真实移动/删除/角色行为与foreign lease拒绝回归。完成前正式full、GitHub、版本、生产和真实Provider继续禁止。
- 第十五候选退回P1已关闭：Canvas新增单次admission的`mutateGraph`组合端口，基于同一pending snapshot规划和重算nodes+edges，目标集合扩张fail-closed，一次checkpoint后原子提交；Text移动/删除/角色修改只在返回成功后撤销intent。foreign lease拒绝保持node、edge、旧错误和intent不变。
- 最小直接证据为safe m27 `21/21 PASS`，新增真实浏览器路径覆盖角色、顺序、删除、foreign lease、intent与持久化原子性；库存1119、异常0、source/snapshot`5e2a807b27cf9c3527cbe569e08f2a72524b637367d875fb79923189984809fa`、4173 unchanged，TypeScript/diff-check通过。两次前置诊断失败仅为测试fixture缺模型与缺正式项目保存身份，均未发现产品失败；Provider POST/费用及生产/OSS/真实数据写0。当前先同步治理并跑m38，随后冻结第十六候选交原两个上下文完整只读终审。
- 治理safe m38为`16/16 PASS`，库存1119、异常0、source/snapshot`bb48efe0f4765dbeb4e5f25ae449cb460dbe4aa3f6e666c385c739831e524d89`、4173 unchanged；随后只回写治理证据与冻结状态。第十六候选产品/测试树`5e2a807b…09fa`现已冻结，只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十六候选主线程终审发现`P1=1/NO-GO`并解冻：共享Canvas admission仅覆盖内存commit，不覆盖随后异步flush/confirmed revision；后来的另一标签group可在旧服务器图仍有效时取得锁并提交。已有foreign lease拒绝测试只证明反向顺序，不能证明mutation-first的durable ordering。整改须把所有语义/结构mutation的锁生命周期延长至保存与revision确认，或提供等价durable fence，并补真实双标签“保存延迟+组点击”零旧语义POST回归。
- 第十六候选退回P1已关闭：共享Canvas admission在内存commit后继续持锁，真实项目必须完成flush与confirmed revision后才释放；全部admitted node/edge/graph/结构mutation共用该durable settlement，既有单节点和模型迁移外层临界区保持不变。m27真实双标签延迟PUT时第二页无法取得同一Canvas lock，保存确认后才可取得；最终`21/21 PASS`，库存1119、异常0、source/snapshot`b8e125aedc36152b734f742e3ad170805a173952d2bd64b2467b51205d72a8c2`、4173 unchanged，TypeScript/diff-check通过。当前先同步治理并跑m38，再冻结第十七候选。
- 治理safe m38在六份文档同步后为`16/16 PASS`，库存1119、异常0、source/snapshot`e4678fb397e8c7f8529944ccb675c6cf1925b7a3c191e8b950fb210817fe3416`、4173 unchanged；其后只回写治理证据与冻结状态。第十七候选产品/测试树`b8e125ae…a8c2`已冻结，只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十七候选工作流完整只读终审已覆盖76/76个安全范围改动文件、全diff/hunk、关键分支与完整调用链，结论`P0=0/P1=6/P2=3/NO-GO`并解冻候选。P1分为：单节点POST返回后fresh-plan fence；existing-task apply+durable flush的Canvas admission；upload adoption的admission；Image tool placeholder/derived graph mutation admission；ReactFlow raw edge remove；intent仅在durable applied后清理。P2只登记直接时序回归与非付费raw graph路径缺口，不借机泛化重构。模型/Provider审查按P1硬门停止；整改与重新完整终审GO前正式full、GitHub、版本、生产和真实Provider继续禁止。
- 第十七候选退回六项P1已关闭：single-node task返回后执行fresh semantic plan fence；existing-task binding/terminal apply/flush重新取得Canvas admission；上传完成态、Image tool图命令与edge remove统一admitted；四类节点intent仅在durable applied后撤销。Playlist导出同步改为原子graph mutation，避免异步adoption结果被同步误判。
- 最小直接证据为safe m100 `15/15`、m27 `21/21`、m1-minimap-edge `7/7`、m37 `35/35`、m30最终`13/13 PASS`；库存1120、异常0、最终产品/测试source/snapshot`c4b9bce69bdba61455dd639249cfe09c9475ab2ff9bda2cb3b63cc371ab40933`、4173 unchanged，TypeScript/diff-check通过。m30诊断失败只用于更新旧源码断言并等待新增durable admission/selection时序，没有放宽产品门。
- 当前同步六份治理文档并运行治理m38，随后冻结第十八候选交原两个上下文重新完整只读终审；Review GO前正式full、GitHub、版本、生产和真实Provider仍禁止。
- 治理safe m38为`16/16 PASS`，库存1120、异常0、source/snapshot`cf0537377ced189d4a9c801fd65fac1f55cd926025770d0370ebdbb10ce3dedf`、4173 unchanged；其后仅回写治理证据与冻结状态。第十八候选产品/测试树`c4b9bce6…40933`已冻结，只交原两个审查上下文重新完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十八候选两路完整只读终审合并为`P0=0/P1=4/P2=3/NO-GO`并已解冻。模型/Provider范围10/10 published、11/11 exact identities全部覆盖，结论`P0=0/P1=0/P2=1/GO`；工作流范围84/84文件和完整调用链覆盖，结论`P0=0/P1=4/P2=2/NO-GO`。全程未测试/build/联网/Provider/OSS/生产，两个受保护JSON未读取。
- 四项P1整改边界：最终group admission必须在同一Canvas admission内复核durable revision+normalized snapshot；四类手动暂停恢复必须await graph apply/flush/revision后才清intent；上下文菜单删除必须锁定所有被删边外部端点并在锁内重算；媒体上传开始态和控件必须进入awaited admission/semantic block。三项P2在相同局部关闭：relay usage occupied IDs按fixture隔离、raw edge add/replace和raw node remove统一转入受保护图事务。
- 只运行m22/m27/m30/m37及模型P2直接依赖的最小受影响回归；通过后同步六份治理文档、治理m38、冻结第十九候选，再由原两个审查上下文完整复核。Review `P0/P1=0/GO`前正式full、GitHub、版本、生产和真实Provider继续禁止。
- 第十八轮全部退回项已按上述边界关闭：group最终准入重读authoritative revision并从最新图重算计划/锁/snapshot；手动终态与媒体adoption只有在Canvas admission内durable settle后才清intent或更新本地UI，settle失败按语义data CAS回滚；删除、raw edge/node mutation与上传开始态统一admitted；relay occupied task按fixture隔离。
- 首轮五spec `127/132 PASS`精确分出测试时序与一项真实adoption回滚缺口；修复后最终m22/m27/m37为`44/44、22/22、36/36 PASS`，合计`102/102`，source/snapshot`21a1b01de4a1a032bbc0a7523cc8efd357ca052d71387a71e422da73253fd422`、库存1122、异常0、4173 unchanged。此前同整改树m30 `13/13`与m57 `17/17 PASS`继续有效；TypeScript/diff-check通过，Provider POST/费用与生产/OSS/真实数据写0。
- 当前同步六份治理文档并运行治理m38；通过后冻结第十九候选并交原两个审查上下文完整只读复核。当前不是Review GO，正式full与后续发布/Provider步骤继续禁止。
- 治理safe m38为`16/16 PASS`，库存1122、异常0、source/snapshot`569970149915b79eab202b1f2e5ae4ac3b1210124786d96914bc49d5653452f6`、4173 unchanged；其后只回写治理证据与冻结状态。第十九候选产品/测试树`21a1b01d…fd422`已冻结，只交原两个审查上下文完整只读终审；Review GO前不运行正式full或任何发布/Provider步骤。
- 第十九候选两路完整只读终审已合并为`P0=0/P1=0/P2=1/GO`：工作流覆盖84/84安全范围文件与21/21测试调用链，模型/Provider覆盖10/10 published logical models、11/11精确registry identities与全部adapter/protocol分支。独立Review硬门已通过，候选保持冻结，先运行治理m38，再执行本Goal唯一正式safe full。
- 工作流审查新增一项非阻断`P2-19-1`：adoption持久失败的node-level回滚可覆盖同页并发position/selection/dimensions更改；不涉及重复付费POST或错误task恢复。按本方案Review协议登记后续字段级三方CAS+m37回归，不因非阻断P2解冻或重启无限终审。
- Review GO治理同步后safe m38为`16/16 PASS`，库存1122、异常0、source/snapshot`783344b10af4f2a227ea3bcaca91ea449912067cb131fd02b269f7c7f67da259`、4173 unchanged。产品/测试候选未改，现进入`FORMAL_SAFE_FULL_READY`；只能执行一次正式full并诚实保留原始结果。
- 唯一正式safe full现已执行并永久消费：122/122 specs、1122 tests，`1023 PASS / 95 FAIL / 4 NOT_RUN`，retries0、reportErrors0；source/snapshot`15fa9980a35e17f845299e9db2731b11a635b38180e696f9fa77d6090b0dacd2`，immutable release builder `1/5 PASS`，4173 unchanged。禁止第二次full；当前退回失败根因整改，只能运行最小失败spec，全部关闭前不得进入R7、GitHub或生产。
- full失败整改第一批修复同页连续Canvas修改被异步admission拒绝/丢失的问题：同一标签已持有graph admission时，后续同节点修改直接合并进当前pending graph；durable settlement循环确认最新document/graph fingerprint后才释放跨标签锁。任务面板旧fixture补齐完整版本身份。safe m86最终`83/83 PASS`（`18ef7c5a…7dce`），治理m38 `16/16 PASS`（`6f888528…21eb`），异常0、4173 unchanged；TypeScript/diff-check通过。后续继续按剩余失败共享根因分批，仅跑最小失败spec，不重跑full。
- full失败整改第二批把Image/Audio/Video上传开始态到完成态纳入可观察的Canvas admission：先建立operation/in-flight围栏再await图事务，旧render不得误取消新上传；`uploading`或Canvas pending期间替换和隐藏上传控件保持禁用，完成态继续走durable adoption。m2-image连续上传等待真实控件恢复，GPT Image工具fixture补齐configuration/release/generation identity；最终safe m2-image `13/13 PASS`，m2-audio+m2-video `5/5 PASS`，共同source/snapshot`299d2e9a…783ae`，异常0、4173 unchanged，TypeScript/diff-check通过。唯一full不重跑，继续处理m2-text、m50、m84等剩余失败根因。
- 第二批治理同safe m38 `16/16 PASS`，失败/重试/跳过/reportErrors0，库存1122、source/snapshot`e795be0726084ac5ada46e6e171f94b5511393e3dd61fa9ed55d167e8379f51f`、4173 unchanged。本批checkpoint已闭合；继续仅运行m2-text、m50、m84最小失败spec，不重跑正式full。
- full失败整改第三批关闭Text保存状态与陈旧异步echo：Canvas admission真正开始时发布save-start；TextNode以mutation version和pending fence保留最新rich text。safe m2-text `8/8 PASS`，source/snapshot`eb2d3fe…2493`。m50仅补published fixture的合法configuration revision与immutable release UUID后`2/2 PASS`；m84-copy-paste无需产品改动即`3/3 PASS`，两者最终source/snapshot`b5d58e55…77d9`。全部末次证据异常0、库存1122、4173 unchanged，TypeScript/diff-check通过；当前治理m38待执行，正式full禁止重跑。
- 第三批治理safe m38为`16/16 PASS`，source/snapshot`f181f990110e42b992d3ea8415104c9f06cef54acb737f2c8627503ad5ba2d69`、库存1122、失败/重试/跳过/reportErrors0、4173 unchanged。正式full保持永久已消费，后续只允许冻结整改候选并做原审查上下文增量复核，不得用第二次full替代证据。
- 第三批整改候选已按`f181f990…2d69`冻结，只交原两名审查上下文只读增量复核Text/Canvas保存链、m50 published fixture identity及copy/paste直接调用链；任一P0/P1即解冻退回最小修复，不运行第二次full。

### R6 第三轮整改与第四候选冻结回写（2026-08-29）

- 第三轮6项P1已关闭：immutable release UUID、corrupt/mixed checkpoint全入口权威重建、四类standalone revision+contract、workflow服务端幂等binding、relay取消费用围栏、standalone projected recovery均贯通；同局部4项P2（active-contract健康、lease完整scope、imageTool intent、治理文字）同步关闭。
- 风险定向证据全绿：m22 `43/43`、m40 `14/14`、m100 `13/13`、m102 `22/22`、m5+m38 `42/42`、m27 `20/20`、m30 `11/11`、m12 `6/6`、m81 `41/41`、m86 `83/83`、m88 `36/36 PASS`；治理同步后m38 `16/16 PASS`。库存1105、异常0、4173 unchanged；末次治理safe source/snapshot`9c142661398981539539e7108431cfe12cd87bd1df6bcc4221be4834c5fba6de`，typecheck与diff-check通过。
- 第四候选已冻结，只交原两个审查上下文做只读逐代码复核；这不是独立Review GO。任何P0/P1未清零仍禁止唯一正式full、GitHub、版本、生产和真实Provider。

### R6 第四轮终审退回项（2026-08-29）

- 两路合并去重为`P0=0/P1=7/P2=4/NO-GO`。P1覆盖standalone完整identity与node-only fallback、unknown adoption、workflow failed/cancelled terminal identity、navigation/delete corruption、exact-key lease/checkpoint strict parser，以及Doubao TTS客户端/服务端submittable ownership一致性。
- P2覆盖Mureka/OpenRouter响应必须恰好单结果、image-tool graph operation CAS、模型迁移中间metadata约束。只在同一局部关闭，不借机扩张架构。
- 模型审查上下文因只读通配误触受保护R0 JSON而按边界停止；无写入、测试、构建、网络或外部操作。整改后仍由原上下文继续未完成范围与增量复核；任何P0/P1未清零不得进入唯一正式full。

### R6 第三轮终审退回项（2026-08-28）

- P1共6项：release UUID与configuration hash身份混用；损坏checkpoint Continue/同run冲突记录可绕过重建；四类standalone未隔离revision+contract；workflow binding未纳入服务端幂等intent且early replay过早；relay取消后缺remote-may-still-run费用围栏；带revision的已投影standalone success误阻断group。
- P2共4项：active-contract完整健康/bootstrap门、lease account/fixture隔离、imageTool服务端幂等intent、`AGENTS.md`历史授权文字。P2只在本事件局部关闭，不扩张架构。
- 整改后只跑最小直接依赖并重新冻结；由原两个审查上下文继续复核。任何P0/P1未清零继续禁止正式full、GitHub、版本、生产和真实Provider。

### R6 独立终审退回项（2026-08-28）

- 工作流12项P1覆盖：规范化语义贯通、accepted-only续作、终态通知去重、服务端孤立task重建、混合cache corruption、并发安全回滚、多group调用者、durable restart、手动corruption准入、success proof语义复用、snapshot role/order/revision完整性、malformed lease导航fail-closed。
- 模型/Provider4项P1覆盖：Mureka歌词边界、relay响应结果数量、Seedance重叠模式priority发布门、统一server-side feature-flag fail-closed闸门。
- P2共8项登记：Canvas pending snapshot/批连线一致性、VideoNode成功清理/undo边界、active revision TOCTOU、availability contract gate、不可路由registry identity、bootstrap统一totality发布门。P2只在不扩大本事件且与P1同一局部修改时顺带关闭，否则保留登记。
- 修复顺序按安全依赖执行：先缓存/任务/费用围栏与snapshot语义，再Canvas原子回滚和执行器合同贯通，再模型/Provider发布与结果边界；每批只跑最小直接依赖。全部P1关闭后重新冻结，交原两个审查上下文增量复核；只有`P0/P1=0/GO`后运行唯一正式safe full。

### R6 第二轮整改回写（2026-08-28）

- 8项P1已逐项落实：run级终态通知统一去重；服务端admission原子持久化workflow binding；损坏cache和lease全入口fail-closed；task-first恢复覆盖POST后Canvas绑定前；terminal核冻结revision/contract；Canvas稳定后重算lease lock set；snapshot restart先持久化新run且支持双记录崩溃恢复。
- 3项P2已逐项落实：availability接active contract/registry totality；单连接与批连接统一pending graph快照；任务面板逐group/run显示Continue。权威重建同时区分已投影standalone成功task，并只隔离实际blocked group，避免无关组被连带阻塞。
- 最小验证保持风险驱动：m30 `11/11 PASS`、m22 `43/43 PASS`、typecheck与diff-check通过；没有运行正式full、网络、Provider、OSS或生产。
- 当前停在第三候选独立Review硬门；第三轮任何P0/P1都会解冻退回最小修复与最小复验。

## 0. 先给结论

这次暴露的不是一个错误，而是三个相互放大的结构问题：

1. 整组运行的未完成记录虽然保存了 `groupId/runId`，新一轮准入却只读取整张画布最新一条记录，因此一个组失败能误挡同画布其他组；恢复入口又停留在任务面板，违背“一次点击后系统自己跑完”的产品合同。
2. Seedance 2.0 Mini 的“全能参考”合同本身支持文字、图片、视频、音频，但切换模型或输入模式时只改节点参数，不原子迁移已有连线角色。旧的 `first-frame` 被原样保留到只接受 `subject/reference-image` 的全能参考模式，最终在 Provider 前被本地预检拒绝。不是 Seedance Provider 不支持全能参考，是本地模型/模式/连线角色三者失去一致性。
3. 模型目录、前端 schema、发布 revision 和执行器之间缺少“所有合法组合必须可执行”的完备性证明。Grok 当前发布 schema 可接受 `reference-image/subject`，但声明式执行合同只实现文字和单首帧；Mureka UI 可选 2/3 条，真实任务准入却只允许 1 条。现有发布门能证明字段安全，却不能证明每个 UI 合法选项都能走到唯一真实请求。

因此不能继续以“某模型报错就加一个 provider/model 判断”修补。INC-GEN-017 必须同时完成：

- 按 `account + canvas + group + run` 隔离工作流运行；
- 点击生成时自动恢复、自动规范化、自动继续，失败终态自动释放，不再要求用户去任务面板；
- 建立模型输入的单一归一化结果，由 UI 预览、任务准入和 Provider 执行共同消费；
- 发布模型前证明 schema 中每一种合法的模式、角色、数量和参数组合都能唯一编译到真实执行器；
- 当前全部 10 个已发布模型做合同普查和切换矩阵，新增模型默认 fail-closed，不能靠通用兜底猜测上线。

2026-08-28最终审计已关闭六项P1：浏览器checkpoint权威过重、旧快照继续pending规则缺失、共享归一化过度耦合、Grok/Mureka决策悬空、用户错误提示缺少限流，以及关闭通用兜底顺序可能误伤现有模型。最终方案不再保留上述开放分支。

本文件最初只冻结方案；该历史边界已由本Session最新显式`/goal`取代。当前权限、安全红线、费用上限与执行次序以一次性Goal和实时Checkpoint为准。

## 1. 权威入口与范围

- 详细方案：本文件。
- 验收门：`spec/INC_GEN_017_ACCEPTANCE_MATRIX_2026-08-28.md`。
- 实时断点：`spec/INC_GEN_017_CHECKPOINT.md`。
- 生产事实继续以 `spec/UNBOUNDRY_CURRENT_STATE.md` 和 v0.6.56 回执为准。
- 历史 INC-GEN-016、MODEL-CONTRACT-001/002 的回执和时点不改写。
- 受保护 `spec/public-templates-director-split-revision.json` 禁止读取、修改、暂存、移动或删除。

### 1.1 进入本事件

- 整组执行准入、checkpoint/lease/lock/summary、自动恢复和终态清理。
- 模型切换、模式切换、连线角色迁移、输入预检和错误清理。
- 模型 schema、不可变 revision、执行合同 compiler、专用 adapter 和发布门的一致性。
- 当前 10 个已发布模型及以后新增模型的完备性验证。
- 旧 Canvas、旧模板、旧任务和旧 revision 的兼容读取与按需规范化。
- 费用不确定、退款、明确失败、Provider 已受理和结果投影的安全恢复。

### 1.2 不进入本事件

- 不重写 React Flow，不重做整个 Canvas，不引入微服务。
- 不把所有 Provider 强行合并成一个万能请求结构。
- 不删除用户已有连线或媒体来“让预检变绿”。
- 不静默把用户明确选择的首尾帧语义降级成无关语义。
- 不批量改写历史 immutable revision、历史任务请求或历史生产回执。
- 不增加模型能力；只把已经声明的能力与真实执行统一。
- 不以真实付费生成代替自动合同验证。

## 2. 已证实代码事实

### 2.1 画布被旧运行记录卡住

- `client/src/generation/WorkflowExecutionProvider.tsx` 的 `executeGroup()` 使用只含 account/canvas/fixture 的 scope 调用 `readGroupRunCheckpoint(scope)`；读到任意非活动 run 就直接提示“当前画布有一轮未完成记录”并返回。
- `client/src/generation/groupRunCheckpoint.ts` 实际可以保存多个 checkpoint，记录中也包含 `groupId` 和 `runId`；但不传 runId 时返回整个 scope 中更新时间最新的一条。
- 失败会把当前 run 写成 `interrupted`；成功才清理。任务面板提供“继续/放弃”，主生成入口没有自动接管。
- `accepted-tasks-only` 只会恢复已经有 taskId 的节点，不会继续提交尚未运行的后继节点。
- `client/src/generation/workflowExecution.ts` 已能在 DAG 内只阻断失败后代、继续独立分支；真正扩大故障域的是外围准入和 checkpoint 生命周期。

结论：checkpoint 数据不是错，读取和准入的隔离维度错了；恢复机制也没有完成从“人工工具”到“产品默认行为”的闭环。

### 2.2 Seedance 全能参考被旧角色污染

- `types/modelParameters.ts` 中 Seedance 2.0/Mini 明确有 `text / first-last-frame / multimodal` 三种模式；`multimodal` 支持最多 9 图、3 视频、3 音频，图片角色是 `subject/reference-image`，视频和音频分别有参考角色。
- 同一 schema 的 `switchPolicy` 是 `keep-edge`。
- `types/nodeInputs.ts` 只有当边没有显式角色，或角色仍是默认 `reference-image` 时才应用模式自动分配；显式 `first-frame` 会被保留，随后在 multimodal 模式下触发 `ROLE_UNSUPPORTED`。
- `client/src/canvas/VideoNode.tsx` 切换模型时重置参数，但不更新相连 edge；切换 `inputMode` 时也只更新参数，不迁移角色、不清理与旧输入合同绑定的服务端错误。
- `server/volcengineArkVideoProvider.ts` 已支持 Seedance 的 `first-frame/last-frame/reference-image/reference-video/reference-audio/subject` 请求角色。

结论：“全能参考”没有被 Provider 限制；本地切换事务不完整。模型、模式、角色和错误必须作为一次原子编辑提交。

### 2.3 当前发布门不能证明模型真的可执行

- `server/modelReleaseDefaults.ts` 的 Grok 声明式执行合同只有文字和单首帧两条模式。
- 当前 Grok 发布 schema 却能让 `reference-image/subject` 通过前端/服务端输入解析；执行 compiler 无法唯一选中模式时才阻断。
- `types/modelParameters.ts` 允许 Mureka `outputCount` 为 1/2/3，`server/murekaAudioProvider.ts` 也能构造 1～3 条请求；但 `server/generationTasks.ts` 和 `server/generationTasksApi.ts` 在真实任务准入中强制音频只能为 1。
- `server/modelCatalog.ts` 对 relay 发布只校验通用字段、角色集合和单结果，不枚举 schema 合法组合验证是否能落到真实 adapter。
- `server/modelReleaseDefaults.ts` 可把未知非原生模型归为 `specialized-code`；`server/modelAvailability.ts` 又可能仅因协议已知而认为 adapter 可用。新增模型存在“可发布、可选择，但没有精确执行合同”的窗口。

结论：不是所有模型都已经坏，但当前系统确实存在已证实的 Grok 与 Mureka 合同矛盾，也没有机制证明其他模型和未来模型不会被同类矛盾误伤。

## 3. 冻结产品合同 SHC-01～27

| ID | 冻结要求 |
|---|---|
| SHC-01 | 用户点击一次整组生成后，系统自行预检、规范化、提交、恢复、继续后继节点、保存和回填；正常流程不要求进入任务面板。 |
| SHC-02 | checkpoint、lease、lock、summary 以 `accountId + canvasId + groupId + runId` 定位；同画布不重叠组互不阻塞。 |
| SHC-03 | 同组存在未完成 run 时，新点击默认接管原 run，不创建并行新 run；只有明确安全终态才开始新 run。 |
| SHC-04 | 没有任何 Provider 受理证据且预检不可修复时，自动把该 run 收口并释放准入，不留下永久 interrupted 锁。 |
| SHC-05 | 已受理任务只恢复原 task；刷新、重启和重复点击不得生成第二个付费 POST。 |
| SHC-06 | outcome unknown 只允许核对原任务，永远禁止新付费 POST。 |
| SHC-07 | Provider 明确退款或可证明未受理时，按统一 retrySafetyDecision 最多自动新提交 1 次；每次决策有持久证据。 |
| SHC-08 | 部分成功要保留 task/result/success proof；失败节点的后代按 DAG 阻断，独立分支继续；重新点击只补未完成部分。 |
| SHC-09 | Provider 成功与 Canvas 投影分离；投影失败不得把生成成功降级，也不得触发重新付费。 |
| SHC-10 | 模型切换、模式选择、边角色迁移和旧错误清理是一个原子 Canvas 编辑，可撤销、可保存、不可出现半状态。 |
| SHC-11 | 不删除媒体、不删边、不静默丢参考；能无损解释时自动选唯一兼容模式并迁移角色，不能解释时给出精确阻断。 |
| SHC-12 | Seedance：纯文字→text；一张或混合参考素材→multimodal；恰好两张且用户明确选择首尾帧→first-last-frame。 |
| SHC-13 | Seedance 从首尾帧切到全能参考时，旧 `first-frame/last-frame` 图片角色按顺序迁移为 `reference-image`；不改媒体和连线。 |
| SHC-14 | 每个 schema 合法的模式、角色、数量、参数组合必须编译到恰好一个执行路径；0 条或多条都禁止发布。 |
| SHC-15 | UI schema、任务准入、费用估算和请求compiler共同依据同一个版本化语义合同；Canvas与Provider保留独立adapter，不各自维护相互矛盾的能力判断。 |
| SHC-16 | 专用模型必须绑定精确 connector/adapter 合同；`specialized-code` 不能作为缺少实现时的发布兜底。 |
| SHC-17 | 未知 provider/model/mode/role/parameter 默认 fail-closed，并在管理员发布阶段暴露，不等用户付费时才发现。 |
| SHC-18 | 旧任务按冻结 revision 执行；旧 Canvas/模板只做可证明无损的按需规范化，不批量改写历史语义。 |
| SHC-19 | 当前 10 个已发布模型逐一建立 schema→compiler→adapter→result/recovery 证据；不得用抽样代替“全部当前模型”。 |
| SHC-20 | 自动技术通过、真实 Provider 通过、生产技术通过和用户主观验收严格分层。 |
| SHC-21 | localStorage checkpoint只是恢复缓存；付费身份以服务端task/attempt和Canvas任务绑定为权威。缓存缺失、损坏或过期不得永久阻塞组或画布。 |
| SHC-22 | 恢复原accepted task与继续pending严格分开：原任务始终只恢复；只有snapshot一致才继续旧run。snapshot变化时自动收口旧run，再按当前图建立新run并仅复用语义指纹仍一致的成功结果。 |
| SHC-23 | 普通用户不接触Provider平台、平台URL、平台任务号或“人工核对”；结果必须优先自动回到原节点。任务中心/素材库只是项目内部安全副本，不是正常流程必经页面。 |
| SHC-24 | 瞬时与恢复中状态不弹红错；同一`runId + nodeId + errorClass`合并为一个中性状态，恢复成功静默完成，只有不可恢复终态最多显示一次红色说明。 |
| SHC-25 | 共享层只拥有纯语义合同；Canvas原子编辑和Provider请求编译分别由独立adapter拥有，UI不得依赖Provider请求字段，Provider adapter不得修改Canvas图。 |
| SHC-26 | 本事件不扩张能力：Grok只开放已证明的纯文字与单首帧；Mureka固定单结果1条。未来扩能必须另立合同、结果资产和用户验收。 |
| SHC-27 | 不静默改Prompt、跨模型/跨Provider兜底或绕过审核。内容拒绝、权限/余额/订阅不足、缺少不可替代素材等不可恢复失败只终止受影响分支，保留其他结果并显示一次项目内说明。 |

## 4. 目标架构

### 4.1 工作流：从画布级阻塞改为组级状态机

恢复事实分三层，禁止倒置：

1. 服务端 `generation task + execution attempt + providerTaskId + result asset` 是Provider受理、费用和结果的唯一权威。
2. Canvas上的 `taskId + ownershipKey + workflowExecutionRunId + inputFingerprint` 是结果应投影到哪个节点的权威绑定。
3. localStorage checkpoint/lease只是浏览器调度缓存和跨标签互斥提示；缓存不存在或损坏时必须从前两层重建安全决策，不能要求用户放弃，也不能放开重复付费。

```text
IDLE
  -> PREFLIGHTING
     -> NORMALIZING_INPUT_CONTRACT
        -> RUNNING
           -> PARTIAL_RECOVERY
              -> RUNNING
           -> RESULTS_COMMITTED
              -> COMPLETED -> checkpoint cleared
     -> IRREPARABLE_ZERO_ACCEPTED
        -> CLOSED -> checkpoint cleared

任何阶段若存在 accepted/original task：
  -> RECONCILING_ORIGINAL_TASK (zero new POST)
     -> RUNNING / RESULTS_COMMITTED / REFUNDED / PROVIDER_FAILED

OUTCOME_UNKNOWN_BILLING_RISK
  -> RECONCILING_ORIGINAL_TASK only
```

关键决策：

- admission 先查询目标 `groupId` 的 checkpoint，而不是画布最新 checkpoint。
- 同一 group 的 checkpoint 按 runId/更新时间选唯一可接管项；多个相互矛盾记录进入管理员诊断，但不阻塞其他 group。
- 主按钮直接调用统一 `resumeOrStartGroup()`；任务面板只做观察和诊断，不再拥有独占恢复能力。
- `accepted-tasks-only` 升级为两阶段：先只恢复原 accepted tasks；确认安全后继续调度尚未运行节点。
- 组内不可修复且 `acceptedTasks=0` 时自动清理；有 accepted task 时绝不清理证据，只释放无关组准入并后台核对原任务。
- snapshot一致时才允许继续原run的pending节点。snapshot变化时先恢复accepted task；随后关闭旧run，按当前Canvas创建新run，只复用`taskId + ownershipKey + resultKey + inputFingerprint + revision`仍一致的成功结果。
- checkpoint缺失/损坏时，自动扫描本组Canvas绑定和服务端task：无已受理任务则清理陈旧状态并开始；有已受理任务则重建只恢复绑定，禁止新POST。

本事件冻结的生命周期保证：页面打开时自动跑完整组；刷新或断网重连后无需点击任务面板自动继续；已经Provider受理的任务在关页后仍由服务端继续收片，尚未提交的下游在用户再次打开项目时自动继续。把整个DAG改为无浏览器服务端调度属于另一项架构能力，本事件不复制一套服务端执行器。

### 4.2 模型输入：共享语义、独立适配

新增纯语义编译边界，名称可在实施时确定，但职责必须固定：

```ts
normalizeModelInputs({
  modelReleaseRevision,
  requestedParameters,
  connectedInputs,
  transitionIntent, // load | model-switch | mode-switch | execute
}) => {
  normalizedParameters,
  normalizedSemanticInputs,
  selectedExecutionMode,
  warnings,
  blockingProblems,
  contractFingerprint,
}
```

三层责任必须分离：

1. `ModelInputSemanticCompiler`：共享纯函数，只处理revision、模式、媒体种类、角色、数量、顺序和参数约束；不导入React、Canvas存储、HTTP或Provider字段。
2. `CanvasModelTransitionCommand`：把语义结果转换为一次nodes+edges图事务，统一undo、save和失败回滚。VideoNode只提交命令，不直接拥有角色迁移逻辑。
3. `ProviderRequestCompiler/Adapter`：服务端把已验证语义输入映射为精确Provider请求；拥有请求字段、鉴权、响应、费用和结果数量，不修改Canvas。

共享的是不可变revision、语义结果和fingerprint，不共享UI mutation或Provider request对象。服务端仍是最终权威；客户端用于即时预览，服务端用同版本重算。不一致时fail-closed且Provider POST=0。

### 4.3 Canvas 原子模型切换命令

- `VideoNode`只调用`applyModelTransition(nodeId, targetModelId, requestedMode)`。
- 命令先dry compile，再在Canvas状态所有者中一次提交nodes+edges after-state；undo记录一个事务，保存只产生一个合并版本。
- 保存和revision确认完成前禁止Provider POST。保存失败恢复完整before-state，不允许节点已换模型但连线仍为旧角色。
- 只清理由旧contractFingerprint产生的预检/服务端错误；task、result、ownership和用户素材不得被清理。

### 4.4 模式选择优先级

模式不按模型名硬编码，而按 revision 声明的输入集合和迁移规则选择：

1. 用户刚刚明确选择某模式，且现有输入可无损满足：保留该模式。
2. 当前模式不兼容，但存在唯一接受全部现有输入的模式：自动切换并迁移角色。
3. 存在多个候选：使用 revision 中显式 `normalizationPriority`；没有优先级则阻断发布，不在运行时猜。
4. 没有候选：保留所有边和素材，阻断当前节点，错误必须指出缺什么或哪条边角色不被支持。

Seedance 的冻结优先级是：混合模态或单张参考→multimodal；显式且完整的两张首尾帧→first-last-frame；无媒体→text。旧数据加载不凭两张图片自行猜首尾语义，只有已有角色或用户明确选择能证明时才采用首尾帧。

### 4.5 自动恢复与不可恢复失败分类

| 分类 | 系统动作 | 普通用户表现 |
|---|---|---|
| 可确定输入迁移、陈旧角色、陈旧checkpoint | 自动规范化或精确清理后继续 | 不弹红错 |
| 网络瞬断、锁忙、轮询/下载/保存瞬态失败 | 对原操作有界退避；不创建新付费attempt | 一个“正在自动恢复”中性状态 |
| Provider已受理或outcome unknown | 后台只核对原task，禁止新POST | 一个中性恢复状态，不显示平台任务号 |
| 明确未受理或明确退款 | 持久安全决策后最多自动新提交1次 | 不要求用户重试 |
| 内容拒绝、余额/权限/订阅不足、缺少不可替代素材 | 终止受影响分支，其他分支继续；不换模型、不改Prompt | 最多一次项目内最终说明 |
| Provider成功但投影冲突 | 保留正式资产并后台重投影；语义已变化则保留项目内安全副本 | 原节点优先，绝不去外部平台找 |

通知合并键为`accountId + canvasId + groupId + runId + nodeId + errorClass`。恢复轮询和相同瞬态错误只更新同一状态；后台诊断可以记录每次尝试，普通用户界面不得堆叠。

## 5. 逐文件实施清单

以下是预期责任边界，不要求机械按最小 diff 完成；实施前 R0 需重新核对精确行号和依赖。

### 5.1 工作流执行与 checkpoint

| 文件 | 计划改动 | 禁止事项 |
|---|---|---|
| `client/src/generation/WorkflowExecutionProvider.tsx` | 将 `executeGroup` 准入改为 `resumeOrStartGroup(groupId)`；只处理目标组；checkpoint不可用时从Canvas绑定+服务端task重建；accepted恢复后按snapshot规则继续或新建run；错误摘要按组/run合并。 | 不删除费用围栏；不让一个run清另一个run；不把localStorage当付费权威；不在React节点组件中恢复执行逻辑。 |
| `client/src/generation/groupRunCheckpoint.ts` | 将scope API明确拆为`readGroupCheckpoints(scope, groupId)`、`readRunCheckpoint(runId)`、`clearRunCheckpoint(runId)`；增加版本2和v1兼容读取；检测同组多活动记录；把损坏结果返回为可重建状态。 | 不用“最新一条”替代精确身份；不批量删除浏览器存储；不因缓存异常永久阻塞。 |
| `client/src/generation/workflowExecution.ts` | 保持 DAG 独立分支语义；补 resume 后 pending 节点继续调度和 terminal 分类。 | 不把任一节点失败升级成整个画布失败。 |
| `client/src/canvas/GenerationTasksPanel.tsx` | 保留诊断/观察；“继续/放弃”退出正常流程；显示系统自动恢复的合并状态。 | 不再让任务面板成为生成、恢复或找结果的必经步骤。 |
| `client/src/generation/workflowNodeExecutors.ts`、`nodeExecutorRegistry.ts` | 统一消费 normalized input contract 和恢复决策；写回继续校验 run/task/ownership/node/kind/revision。 | 不弱化 ownership/CAS。 |
| 服务端task查询/Canvas绑定reconcile模块 | 提供只读`reconstructGroupRecoveryDecision`，用task/attempt和Canvas绑定重建accepted/terminal/unknown事实。 | 不提交生成、不修改Provider、不凭时间猜未受理。 |

### 5.2 模型输入和 Canvas 原子迁移

| 文件 | 计划改动 | 禁止事项 |
|---|---|---|
| `types/modelParameters.ts` | 为mode增加可序列化的语义约束和优先级；Seedance规则来自revision；Mureka outputCount冻结为`[1]`。 | 不放Provider专属密钥、URL、请求字段或任意脚本。 |
| `types/nodeInputs.ts` / 新纯语义compiler | 把输入解析、语义规范化和Canvas迁移动作分开；输出角色、候选模式、精确问题和指纹。 | 不静默删边/截断输入；不导入React或Provider adapter。 |
| 新Canvas级`CanvasModelTransitionCommand` | 根据语义结果构造一次nodes+edges before/after事务，统一undo、save、revision确认和失败回滚。 | 不把两次独立`setNodes/setEdges`冒充原子事务。 |
| `client/src/canvas/VideoNode.tsx` | 模型/模式改变只发Canvas命令并展示dry结果。 | 不直接迁移edge；不以模型名复制合同；不依赖Provider请求字段。 |

### 5.3 服务端合同与发布门

| 文件 | 计划改动 | 禁止事项 |
|---|---|---|
| `server/modelExecutionContractCompiler.ts` | 增加 compile-totality API：给定 revision/schema 合法组合必须唯一命中 execution mode，并返回完整消费清单。 | 不允许未消费字段/角色悄悄丢弃。 |
| `server/modelReleaseDefaults.ts` | 先为全部当前模型显式注册connector；Grok当前合同收紧为纯文字+单首帧；新发布模型不再从未知项获得可用`specialized-code`。 | 不改写历史revision；不扩大Grok能力；不先删旧runtime再补registry。 |
| `server/modelCatalog.ts` | 发布/更新/回滚前运行 schema 组合枚举、compiler totality、adapter registry、费用/结果数量一致性检查。 | 不把通用角色集合校验当成执行可用证明。 |
| `server/modelAvailability.ts` | “协议被认识”与“该模型合同可执行”分开；可选择必须绑定已验证 revision+adapter。 | 不因 providerProtocol 已知就默认模型可用。 |
| `server/generationTasks.ts` | 任务准入消费服务端语义合同；Mureka保持单结果；删除合同收口后已重复的provider/model判断；费用和输出数量以执行合同为准。 | 不在POST之后才发现无执行路径；不把Mureka扩成未完成的多结果。 |
| `server/generationTasksApi.ts` | API执行通用结构/权限/账本门和合同编译结果；音频单结果来自同一revision合同。 | 不保留UI/API双真相。 |
| Provider adapters | 每个 adapter 声明支持的 revision/mode/roles/parameter/result cardinality；request compiler 断言全部输入已消费。 | 不共享 Grok task ID 路径给无关 connector；不做万能 JSON 猜测。 |

## 6. 当前 10 个已发布模型的处置矩阵

R0 必须从实施时的真实只读目录重新生成完整清单；下表是 2026-08-28 审计基线，不替代实时快照。

| 模型族 | 当前结论 | INC-GEN-017 动作 |
|---|---|---|
| Doubao TTS 2.0 | 未发现 schema/执行矛盾 | 冻结黄金请求、单结果、恢复和切换非回归。 |
| Mureka V9 | 已证实请求能发送1～3，但轮询/任务保存只消费第一条，UI与执行不一致 | 本事件冻结单结果：schema只显示1，API/task/adapter/result均断言1。多结果另立功能，不在本事故扩能。 |
| Suno 4.5 | 未发现当前矛盾 | 冻结专用 adapter 和结果数量，不迁移到通用 relay。 |
| GPT Image 2 | 专用 gpt-image 路径 | 冻结同步结果、媒体保存和恢复，不套异步视频状态机。 |
| Nano Banana Pro | 专用 relay image 合同 | 冻结图片参考、参数和单结果黄金矩阵。 |
| Doubao Seed | Ark 原生文字 | 冻结角色、数量、尺寸和结果资产路径。 |
| Seedance 2.0 Mini | Provider 能力存在；本地切换事务已证实有缺陷 | 实施模式/角色原子迁移，覆盖 text、首尾帧、全能参考和跨模型切换。 |
| grok-video-3 | 发布 schema 与声明式 execution modes 已证实不一致 | 当前schema收紧到已有精确证据的文字+单首帧；reference-image/subject不可选。未来有正式Provider证据后通过新revision扩能。 |
| grok-video-3.5 | 当前专用路径未发现相同矛盾 | 独立冻结其 adapter，不因 grok-video-3 修复共享 schema 或请求规则。 |
| Kling Omni | 当前专用路径未发现相同矛盾 | 冻结全模态输入和专用请求映射；交叉切换矩阵必须通过。 |

所有归档/disabled 模型继续不可被普通用户新选。历史任务仍按自己的 revision 恢复，不能因为当前模型归档而丢结果。

## 7. 旧数据与迁移策略

### 7.1 不做全库图数据重写

Canvas graph 和本地checkpoint都含用户状态。默认采用“兼容读取 + 权威任务重建 + 纯函数按需规范化 + 用户动作时原子保存”，不运行无差别SQL/JSON批量改写。localStorage不是付费权威；本事件也不新增第二套服务端DAG执行器。

### 7.2 checkpoint v1 → v2

- v1 继续可读，按其已有 `groupId/runId` 归类。
- 若同组只有一条有效记录，升级内存表示并在下一次合法写入时保存 v2。
- 若同组存在多条相互矛盾活动记录：不自动选一条付费执行；后台只核对各自已受理 task，禁止新 POST；其他组仍可运行。
- 已终态、零 accepted、无 lease 的陈旧记录可在精确核验后清理；清理必须只针对 runId。
- v1/v2缺失、JSON损坏或浏览器存储不可用时，从当前组节点的task/ownership/run绑定和服务端task/attempt重建。无受理事实则允许开始；有受理事实则只恢复原task。
- checkpoint快照与当前图不同：accepted任务继续恢复，但旧pending永不提交；恢复完成后自动关闭旧run，并按当前图创建新run。

### 7.3 旧 Canvas 输入

- 加载时只做 dry normalization，不自动保存。
- 用户切换模型/模式或点击生成时，如迁移是唯一、无损且不改变媒体集合，则原子保存参数+角色。
- 旧 Seedance `multimodal + first-frame` 一张图可确定性迁移为 `reference-image`。
- 两张无角色旧图不能凭顺序猜成首尾帧；若 multimodal 可接受两图则保留为参考图，否则精确阻断。
- 任何规范化不得改变 prompt、媒体 URL、source node、edge id 或 inputOrder。

### 7.4 历史任务和 immutable revision

- 任务执行继续绑定创建时 revision、connector、profile、credential version 和 request fingerprint。
- 新的 current release policy 只影响新任务/新发布，不用当前 schema 重释旧任务。
- rollback 必须能继续识别新 checkpoint/normalization 版本；不能识别时禁止直接二进制回滚。

## 8. 实施阶段与停止条件

### R0：重新冻结基线和预期红

- 在最新干净 `origin/main` 隔离 worktree 核对分支、HEAD、package/schema、生产版本、10个已发布模型和当前 Canvas/任务事实。
- 生成不含 prompt/媒体/URL/owner/密钥的模型合同快照。
- 补预期红：跨组 checkpoint 误挡、同组自动恢复缺失、Seedance 全能参考旧角色、Grok schema/执行不完备、Mureka outputCount 双真相、未知模型 generic fallback。
- 停止条件：身份不一致、工作树有无法隔离的用户改动、生产已不是预期版本、需要读取受保护文件。

### R1：先关闭工作流卡死与通知风暴

- 准入按group/run定位；checkpoint缺失或损坏时从Canvas绑定+服务端task重建。
- 主按钮自动接管同组；零accepted不可修复自动释放；accepted只恢复原task。
- snapshot一致才继续旧pending；变化时自动关闭旧run并按当前图建立新run。
- 建立通知合并器：恢复中只有一个中性状态，成功静默，最终不可恢复最多一个红色说明。
- 跨标签/Web Lock、节点重叠和直接输入重叠继续fail-closed。

### R2：建立纯语义compiler与Canvas原子命令

- 先做无网络纯函数和测试，不接UI、不接Provider。
- 语义合同不含React/HTTP/Provider字段；Canvas命令和Provider adapter分别消费语义结果。
- Canvas命令一次提交nodes+edges before/after、undo、save与revision确认；VideoNode只发命令。
- 停止条件：需要散落modelId判断、UI导入Provider映射或两次独立状态更新才能完成切换。

### R3：Seedance、Grok、Mureka确定性收口

- Seedance覆盖text、first-last-frame、multimodal及角色原子迁移。
- Grok当前schema只保留文字+单首帧；不扩张reference-image/subject。
- Mureka schema/API/task/adapter/result统一固定outputCount=1。
- 清理只属于旧contractFingerprint的错误；真实task/result/ownership不清理。

### R4：显式adapter registry与服务端发布门

- 先为实施时全部published模型建立精确registry绑定和黄金合同。
- 任务创建前服务端重算语义合同；compiler、费用和adapter一次判定。
- 旧路径与新registry做零Provider shadow compare：请求语义、角色、参数、结果数量、费用和恢复身份必须一致。
- 只有当前模型全部shadow一致后，才禁止未来新模型从未知项获得可发布`specialized-code`；历史revision/在途任务继续用冻结runtime。
- 提供`workflowSelfHealingV2`和`modelInputContractV2`两个临时回退开关，用于灰度/止损；它们不得放宽unknown费用围栏，稳定验收后应移除。

### R5：全模型、动态切换与未来模型矩阵

- 从实施时真实published快照动态生成`N×N`有向模型切换矩阵；当前基线全部10个必须进入。
- 对每个published模型逐一验证schema、黄金请求、结果数量、错误和恢复。
- 枚举字段全覆盖；数值/数量使用边界、等价类和属性测试，不做无界笛卡尔积。
- 加两个未来假模型：精确adapter可发布；只有通用协议而缺精确合同的模型必须被发布门拒绝。

### R6：故障注入与候选冻结

- 覆盖刷新、崩溃、保存失败、Provider 202、响应丢失、taskId 已存、投影冲突、退款、unknown、双击、跨组并发。
- 增加边界Review：禁止registry外新增providerModelId分支；禁止UI依赖Provider字段；禁止Provider adapter修改Canvas；禁止恢复路径产生第二POST。
- 增加体验Review：30次恢复轮询最多一个中性状态；恢复成功红错0；不可恢复终态最多一个红错；结果自动回原节点且无外部平台步骤。
- 定向绿后冻结候选，再做独立只读Review；P0/P1必须为0。
- 只有共享合同传播风险成立时，Review 放行后运行一次正式 safe full。

### R7：本地/预发布浏览器验收

- 假 Provider、临时数据、动态 loopback；绝不使用4173、真实数据、真实密钥或 OSS。
- 用包含三个工作组的真实规模 fixture 验证：A失败可自愈、B/C不被挡、Seedance 全能参考自动迁移并继续下游。

### R8：本Goal已授权的发布与真实验收

- 用户已在本Session通过一次性Goal授权版本、GitHub/CI、可回滚生产发布和累计不超过USD100的最小真实Provider验收；只有全部前置硬门通过后才可消费。
- 候选冻结后仍须按本方案逐项确认版本身份、发布门和实时预算账本，不得因授权存在而跳过安全门。
- 真实验收按实际改动的 connector family 最小化，unknown 时绝不第二次 POST。

## 9. 测试方案

### 9.1 必须新增的测试

- checkpoint：同画布不同组、同组同run、同组多run、v1兼容、精确清理、lease丢失、跨标签锁。
- workflow：零 accepted 预检失败自动释放；部分 accepted 恢复后继续 pending；独立分支继续；失败后再次点击不产生重复 task。
- recovery authority：checkpoint缺失/损坏/被清空时从Canvas绑定+服务端task重建；snapshot变化只恢复accepted、不提交旧pending、自动建立当前图新run。
- Seedance：text↔multimodal↔first-last-frame；一图、两图、图+视频+音频；角色迁移；撤销；保存失败回滚；旧错误清理。
- contract totality：0匹配、多匹配、未消费参数、未消费角色、结果数量冲突、未知 connector、旧 revision。
- Grok：schema 所有合法组合必须全部可编译；当前无证据能力必须在 UI/schema 阶段不可选。
- Mureka：UI/API/provider/result asset均固定单结果；2/3在模型发布和节点UI中不可配置。
- 模型切换：从真实published快照动态生成N×N有向矩阵；只对实际支持组合断言成功，不支持组合必须无损阻断。
- 未来模型：精确注册通过、generic fallback 拒绝。
- 通知：同一错误30次轮询不叠加；中性恢复、静默成功、单一终态错误；普通UI没有Provider URL/task ID/外部核对文案。
- shadow：当前全部模型旧路径与显式registry在零Provider环境下请求语义、费用、结果和恢复身份一致。

### 9.2 风险定向测试基线

候选实施时按变更重新确定最小集合，预计直接覆盖：

```bash
node scripts/run-safe-tests.mjs run \
  --spec tests/m16-volcengine-ark-video-provider.spec.ts \
  --spec tests/m17-model-parameters.spec.ts \
  --spec tests/m22-group-execution.spec.ts \
  --spec tests/m27-node-inputs.spec.ts \
  --spec tests/m30-video-node-inputs.spec.ts \
  --spec tests/m57-relay-generation-runtime.spec.ts \
  --spec tests/m68-viewport-independent-group-run.spec.ts \
  --spec tests/m79-workflow-run-coordination.spec.ts \
  --spec tests/m102-model-execution-contracts.spec.ts
```

命令只是计划，不在文档阶段运行。实施时如新增专用 spec，应优先跑新增 spec 和最小直接依赖；失败只重跑失败集。候选冻结、独立 Review 放行后最多一次正式 full。

### 9.3 每个用例共同断言

- generation task 数；
- execution attempt 数；
- Provider POST 数；
- 原 taskId 是否复用；
- checkpoint/lease 精确身份；
- result asset 数和 ownership；
- Canvas 投影与刷新保持；
- 用户是否被要求人工继续；
- 中性状态、红色提示和重复toast数量；
- 普通UI是否出现Provider URL、task ID或外部核对步骤；
- 费用状态是否 known/unknown/refunded；
- 其他模型/组是否不受影响。

### 9.4 Review协议

只做三次有明确边界的Review，不对无关模块做泛化审计：

1. R2边界Review：检查共享语义compiler、Canvas命令、Provider adapter依赖方向；发现React/HTTP/Provider字段泄漏即P1。
2. R4迁移Review：检查全部当前published模型显式registry、旧/新shadow、历史revision和fallback关闭顺序；任一模型缺证据即P1。
3. 候选冻结终审：只读检查工作流恢复、费用、结果归属、通知体验、动态模型矩阵和回滚；P0/P1必须为0。

Review不得与被审候选同时修改同一源码；发现问题后退回实施、跑最小受影响验证，再由同一审查上下文复核。无关P2只登记，不借本事件重构。

## 10. 发布硬门

任一项失败即 `NO-GO`：

1. 一个组的 checkpoint 仍能阻塞不重叠组；
2. 同组再次点击不能自动继续；
3. 正常恢复仍要求用户进任务面板；
4. Seedance 全能参考仍保留不合法 `first-frame/last-frame` 角色；
5. 模型或模式切换能产生 node/edge 半状态；
6. 规范化会删媒体、删边或改输入顺序；
7. 任一 published 模型存在 schema 合法但 compiler 0/多匹配的组合；
8. 任一请求参数/输入角色被静默丢弃；
9. Mureka UI/API/adapter 结果数量仍不一致；
10. 未注册新模型能靠通用 fallback 发布或变为可用；
11. outcome unknown 能触发新 Provider POST；
12. 部分成功结果会丢失或因投影失败被重提；
13. 旧任务不再能按冻结 revision 恢复；
14. 当前 10 个 published 模型没有逐一证据；
15. 独立 Review 有 P0/P1；
16. 文档、Checkpoint、TASKS、CURRENT_STATE 和验收矩阵不一致；
17. 未获版本号、发布或真实 Provider 授权。
18. checkpoint缺失/损坏仍会永久阻塞，或被当成Provider受理/费用权威；
19. snapshot变化后仍提交旧run的pending节点；
20. 普通用户需要打开任务面板、素材库或任何外部平台才能取得正常结果；
21. 自动恢复过程堆叠红错或重复toast；
22. UI依赖Provider请求字段，VideoNode直接迁移edge，或共享compiler拥有Canvas/HTTP职责；
23. Grok开放未证明的reference能力，或Mureka仍允许2/3结果；
24. 当前模型显式registry和shadow compare未完成就关闭旧fallback；
25. 模型切换矩阵写死当前数量，新增published模型不能自动进入验证。

## 11. 用户验收清单

最终实施发布后，用户只需验证产品结果，不需要理解内部状态：

1. 在模板中选 Seedance 2.0 Mini + 全能参考，接入图片/视频/音频任一支持组合，点一次整组；应自动生成并继续下游，不出现角色错误。
2. 让一个节点遇到可恢复故障后刷新页面；系统应自动继续，不要求再点原组或打开任务面板。
3. 原组失败后立即运行同画布另一个不重叠组；另一个组应正常开始。
4. 切换 Grok、Seedance、Kling 等模型；不支持的输入应在切换时说清楚且保留素材，不能到付费后才报错。
5. 刷新后结果仍在原节点且可直接下载，不重复扣费。任务中心/素材库只作为项目内部安全副本，不能成为正常取得结果的必经步骤。

`AUTO_PASS` 只证明系统合同。真实成片质量和最终体验必须由用户明确确认后才可写 `USER_PASS`。

## 12. 完成定义

INC-GEN-017 只有在以下全部完成后才能技术收口：

- 工作流按组/run隔离且自动恢复；
- Seedance 模型/模式/角色原子迁移；
- Grok、Mureka 已证实矛盾消失；
- 当前全部 published 模型通过 totality 和专用 adapter 矩阵；
- 新模型缺合同默认不可发布；
- checkpoint只是缓存，缺失/损坏可从权威任务和Canvas绑定恢复；旧快照不会提交pending；
- 自动恢复无通知风暴，正常结果回到原节点，普通用户不接触外部平台；
- 当前模型显式registry完成shadow一致后才关闭未来模型兜底；
- 故障注入、定向回归、独立 Review 和必要的唯一 full 通过；
- 生产发布和真实 Provider 验收另获授权并完成；
- 用户在生产实页明确确认后才是 `USER_PASS`。
