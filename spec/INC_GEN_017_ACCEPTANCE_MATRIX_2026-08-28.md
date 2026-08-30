# INC-GEN-017 验收矩阵

状态：`GOAL_ACTIVE / FORMAL_SAFE_FULL_CONSUMED / V0_6_58_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_59_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_60_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_61_MIGRATION_FAIL_CLOSED_UNDEPLOYED / V0_6_62_CANDIDATE_COMMITTED_GITHUB_IDENTITY_PENDING / REAL_PROVIDER_NOT_POSTED / USER_RECHECK`

v0.6.62 post-commit governance gate：safe m38=`16/16 PASS`，source/snapshot=`76716e8779c6a051e087bc3a0bfaf9046fc920e86d01cde7dbeb4985cd2fc747`、库存1125、失败/重试/跳过/reportErrors0、HEAD=`fe152fe35d70dddd2b4e8b201f83ac2635df9241`、Node22.23.1/npm10.9.8、4173 unchanged。governance commit/GitHub identity=`NOT_RUN`，production/Provider门关闭。

v0.6.62 candidate commit gate：commit=`fe152fe35d70dddd2b4e8b201f83ac2635df9241`、tree=`079464b77bbdb226a6fb11c9c4b159fa64590ce1`，exact 10 files、611 insertions/35 deletions；governance docs/protected JSON excluded。post-commit governance m38=`NOT_RUN`，GitHub/production/Provider门关闭。

v0.6.62 Review-GO governance gate：safe m38=`16/16 PASS`，source/snapshot=`ce9126ef4216e1ccad2d80194c51653aa1b3cf64abeb915f1a5afde8d8313fac`、库存1125、失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、4173 unchanged；formal full未重跑，candidate hash仍为`bb364480…ae897`。exact 10-file commit=`NOT_RUN`，governance/protected JSON excluded。

v0.6.62 independent final review gate：冻结hash=`bb364480…ae897`，10/10 files、53/53 hunks、611 insertions/35 deletions、完整chain、10/10 models、11/11 identities、6/6 adapters与全部Provider分支覆盖；`P0=0/P1=0/P2=0/GO`，mixed-template P1=`CLOSED`，finding=0。审查只读且零test/build/network/Git write/Provider/OSS/production/protected JSON access。Review GO governance m38=`NOT_RUN`；commit/GitHub/production/Provider门关闭。

v0.6.62 main-review governance gate：safe m38=`16/16 PASS`，source/snapshot=`bb2f43164ab91e200779c38cb1ab4ac9a3c6e88a65e7132b98fdf944dc1d6d3c`、库存1125、失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、4173 unchanged；formal full未重跑，candidate hash仍为`bb364480…ae897`。independent Review=`NOT_RUN`，commit/GitHub/production/Provider门关闭。

v0.6.62 mixed-template final main review/freeze gate：10/10 files、53/53 hunks、611 insertions/35 deletions；完整schema/near-miss/real before-proposed after/per-template aggregation/migration summary/dry-run/attestation/baseline CAS/transaction command/per-row CAS/revision/activation/audit/rollback/repeat链，10/10 logical models、11/11 exact identities与6/6 adapters/全部Provider分支覆盖。`P0=0/P1=0/P2=0/GO`，candidate hash=`bb3644800553fbe5d7b303e19ec47e33d3d73ae5e6142933e2bece64527ae897`、candidate=`FROZEN`；governance m38与independent Review=`NOT_RUN`，commit/GitHub/production/Provider门关闭。

v0.6.62 post-isolated-recheck governance gate：safe m38=`16/16 PASS`，source/snapshot=`91c82e9a46af03a52e0fb1adfaa798aa08d411fe48891125d693519c8e89ba85`、库存1125、异常0、4173 unchanged。formal full未重跑；exact diff/hash与main/independent Review=`NOT_RUN`。

v0.6.62 mixed-template isolated recheck gate=`PASS`：主副本`pLv6YJ`，attestation`d49ea1a1…47cbb`，dry-run`d3f27a13…a8d1`/plan`8c0dc03c…cc05`，apply`101e0c54…7739`，DB `13589eea…2261→55006ca1…6198`，5 revisions、22 templates/34 nodes。repeat副本`MhUhK0`，attestation`5183e3d3…92cc`，dry-run`9191a7cb…9c3c`/plan`5ff907cd…46f2`为11/11 none、迁移0；apply`d892496f…98db`且DB字节不变。schema41、quick/integrity、FK0、active0、34 image/0 reference、脱敏audit=`PASS`；production v0.6.57/schema41 unchanged，Provider0/USD0。governance m38、main/independent Review=`NOT_RUN`。

v0.6.62 mixed-template P1 remediation gate：逐模板节点聚合只允许“全部不兼容节点均before/after双失败”进入preexisting；混合历史债务+active-pass/target-fail regression保持blocking，apply在写入前fail-closed。TypeScript/diff-check=`PASS`；safe m102首轮`23/24`仅为断言未接受更早的生产矩阵硬门，最终`24/24 PASS`，source/snapshot=`909b1cc8b111f874c21e7414c7932fcd4b96729207271ca604be58925b91d3c0`、库存1125、异常0、4173 unchanged。isolated dry-run/apply/repeat recheck、main/independent Review=`NOT_RUN`；formal full不重跑，GitHub/production/Provider门关闭。

v0.6.62 independent mixed-template review gate：冻结hash=`29e09816…2f55`，10/10 files、50/50 hunks、完整链、10/10 models、11/11 identities、6/6 adapters覆盖；`P0=0/P1=1/P2=0/NO-GO`。P1为templateId级preexisting过滤可由一个双失败历史节点掩盖同模板另一个before-pass/after-fail新回归；candidate=`UNFROZEN`，节点级聚合整改/混合模板回归/隔离复验/重新Review=`NOT_RUN`，GitHub/production/Provider门关闭。

v0.6.62 final main review/freeze gate：10/10 files、50/50 hunks、500 insertions/33 deletions；完整schema/near-miss/template before-after/migration summary/dry-run/attestation/baseline CAS/transaction command/per-row CAS/revision/activation/audit/rollback/repeat链，10/10 logical models、11/11 exact identities与6/6 adapters/全部Provider分支覆盖。`P0=0/P1=0/P2=0/GO`，diff-check=`PASS`，candidate hash=`29e098164e9d996565f7e7b9c57df3738c84c8b783640ddc7e2d589f14c42f55`、candidate=`FROZEN`；independent Review、commit/GitHub/production/Provider=`NOT_RUN`。

v0.6.62 post-migration governance gate：safe m38=`16/16 PASS`，source/snapshot=`57f644da93e3c1520cf51d8003fc0b4e24376da92f909d2f53c9e2fe6648d006`、库存1125、失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、4173 unchanged；architecture/TypeScript/build preflight=`PASS`。formal full未重跑；candidate hash、main/independent Review=`NOT_RUN`。

v0.6.62 final isolated template-migration gate：主副本dry-run报告SHA=`d3f27a13…a8d1`、plan hash=`8c0dc03c…cc05`；apply报告SHA=`37e7f100…7194`，DB `13589eea…2261→19ed87b8…039`，升级5个exact legacy revision并迁移22模板/34节点，复核`image=34/reference=0`、audit无graph正文。新兄弟副本attestation SHA=`34864a3d…c5b5`，repeat dry-run SHA=`e7019f57…2c66`/plan hash=`760e0da9…9fd4`为11/11 action none、迁移0；repeat apply SHA=`7884ff99…8c7e`、`upgradedModels=[]`、DB前后同SHA。schema41、quick/integrity=`PASS`、FK0、active0、Provider POST=0/USD0；production=v0.6.57/schema41 unchanged。isolated migration=`PASS`；governance m38、main/independent Review=`NOT_RUN`。

v0.6.62 explicit template-migration gate：exact legacy Grok3的22模板/34节点由事务计划显式迁移`videoParameters.inputMode=reference`到`image/text`，plan/audit只含template/node和图hash；Templates域transaction-scoped command逐行CAS，与revision发布同事务，失败回滚且repeat action none。架构预检曾以`CROSS_DOMAIN_SQL`正确阻断直接跨域SQL，改为域命令后通过。m102诊断`23/24`两次仅为legacy存储夹具缺失/范围过宽，最终`24/24 PASS`，source/snapshot=`8942d621b2d0a884401a656d909be0552317cf4d93f118eb0d9845c29ba748f4`、库存1125、异常0、4173 unchanged；TypeScript/diff-check=`PASS`。isolated dry-run/apply/repeat recheck、main/independent Review=`NOT_RUN`。

v0.6.62 independent-P1 remediation gate：真实active-before/proposed-after已恢复；exact proof仅放宽runtime-equivalent identity比较，preexisting只接受两侧均失败，active-pass/target-fail与unparseable保持blocking。Grok legacy-only selector回归与apply fail-closed已覆盖。TypeScript/diff-check=`PASS`；safe m102=`24/24 PASS`，source/snapshot=`8ccaa3cd4d9dbbc5d0b710512491b6755fa00c86560d55454da0cb4ad02ac880`、库存1125、异常0、4173 unchanged。isolated migration recheck/main+independent Review=`NOT_RUN`。

v0.6.62 independent review gate：冻结hash=`32345132…3f9b`，8/8文件、31/31 hunks、完整链、10/10 models、11/11 identities、6/6 adapters覆盖；`P0=0/P1=1/P2=0/NO-GO`。P1为exact migration template compatibility使用target作为before并扣除全部parseable incompatible，可能放行active-pass/target-fail模板。candidate=`UNFROZEN`；真实before/after整改、m102回归及重新Review=`NOT_RUN`，commit/GitHub/生产/Provider仍`NOT_RUN`。

v0.6.62 main review/freeze gate：8/8文件、31/31 hunks、321 insertions/16 deletions，完整schema/template/dry-run/attestation/CAS/transaction/activation/immutable/repeat链、10/10 logical models、11/11 exact identities及6/6 adapters覆盖；`P0=0/P1=0/P2=0/GO`。diff-check=`PASS`，candidate hash=`32345132965ccebf0c50b5c5d2f661af326188c9f0e73f512080aa8afc863f9b`并冻结；independent Review=`NOT_RUN`，commit/GitHub/生产/真实Provider=`NOT_RUN`。

v0.6.62 isolated-migration governance gate：safe m38=`16/16 PASS`，source/snapshot=`8a12f5b7402bba528b6caf4a2ccf17583d5112359510d3cb0fc54d91a9c1c11b`、库存1125、失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、4173 unchanged。formal full未重跑；main/independent Review=`NOT_RUN`。

v0.6.62 isolated-migration gate：主副本dry-run报告SHA=`95cd8ffb…e9d`、plan hash=`51ec14bc…e05`；首次apply报告SHA=`9c1cc84b…66af`，五个精确legacy模型升级，paid Provider POST=0/USD0。首次repeat apply在写入前暴露无动作Grok错误要求22模板/34节点矩阵并fail-closed，DB保持`66554d03…1fb`；修复后干净兄弟副本全11身份action none，repeat apply报告SHA=`b1e766b6…4158`、`upgradedModels=[]`、DB前后字节同SHA。隔离库schema41、quick/integrity、FK0、active0、unsettledUnknown0。最终safe m102=`24/24 PASS`，source/snapshot=`34a24549034f773892760f994296a040a348cf93f138b265d93677b41299123a`、库存1125、异常0、4173 unchanged；isolated dry-run/apply/repeat=`PASS`，Review=`NOT_RUN`，生产仍v0.6.57/schema41且未写。

v0.6.62 version/governance gate：safe m38+m81=`57/57 PASS`（16+41），source/snapshot=`dc4cd489d0028154fa162af228c1a7687c57b3e4efbd2ede6cfa8f4c887143f1`、库存1125、异常0、4173 unchanged。正式full未重跑；isolated real-copy migration与Review=`NOT_RUN`。

v0.6.62 direct migration gate：最低未占用身份与隔离分支已确认；真实Grok3.5 row+active exact legacy、current proposed与v1完整runtime identity门已落实，row/active prompt-policy near-miss及非目标证明滥用均阻断。TypeScript/diff-check=`PASS`；safe m102=`24/24 PASS`，source/snapshot=`474120c1f9fdbc854b0c838c3c05d295a655e537377647624fbec06fe5b47099`、库存1125、异常0、4173 unchanged。m81+m38、完整Review、GitHub、生产迁移与Provider=`NOT_RUN`。

v0.6.61 isolated-migration gate：工作副本=`v0.6.61-contract-upgrade.Tupzga`，attestation=`34d80588…c817e`；dry-run在apply前因真实`grok-imagine-video-1.5-preview` prompt policy旧合同而`FAIL_CLOSED`。工作/生产DB SHA均未变，生产恢复v0.6.57健康，v0.6.61=`UNDEPLOYED`；v0.6.62 exact/near-miss整改、定向测试与Review仍`NOT_RUN`，Provider POST=0/USD0。

v0.6.61 frozen-backup gate：正式目录=`/var/lib/unboundry-rollbacks/v0.6.61-cutover-frozen.q9k50E`，source/restore各366文件，双清单=`a758e801…aea2b`，DB=`13589eea…2261`，Library=`444e64f4…80f49`；两副本schema41、quick/integrity、FK0及任务/尝试/媒体/Canvas/模型/模板/Library计数一致，结论`PASS`。首次清单引号失败目录`v0.6.61-cutover-frozen.LRLTxA`保留且生产未写。隔离迁移与真实Provider仍`NOT_RUN`。

v0.6.61 production-quiet gate：连续7次`active=0/unsettledUnknown=0`，current/API version始终v0.6.57，service active/running、NRestarts0，结论`PASS`。首个诊断查询含10条已finished历史unknown（9 failed/1 cancelled），不属于未收口unknown。冻结双副本、恢复验证、隔离迁移与真实Provider仍`NOT_RUN`。

v0.6.61 fresh-build gate：精确tag archive SHA=`70be072c9ea41891fe63f8b793775598307aa49055cb2b6972f94f6b8fdb1a22`且远端校验一致；独立staging=`/opt/unboundry/staging/v0.6.61-inc-gen-017-20260830.Dnplbk`，Node22.23.2/npm10.9.8，npm ci、TypeScript、Vite、6035行inventory和dist33均`PASS`，inventory SHA=`3efd2f7e6eb49b7f829257f484051ae610098b6f9a66f0e80101bfb0719f4600`。生产quiet/冻结备份/隔离迁移/真实Provider仍`NOT_RUN`。

v0.6.61 GitHub gate：final PR head=`36fabedfca269491cb957e460fb9d60cd3145efe` run=`33303459401`/job=`99235705854`、34秒`PASS`；merge=`fe93d8359a5a3ee5f8bfe1d64f494ec87d4b8d3f`，main run=`33303506738`/job=`99235834351`、51秒`PASS`。annotated tag object=`19919318199d6e6b495853ce331c5aa4c00814fd`精确指向merge，Release v0.6.61=`PASS`；fresh build亦已`PASS`，生产/真实Provider仍`NOT_RUN`。

v0.6.61 PR head CI：head=`31c4737f2491de71194c4f42d36be8b27095014d`，Quality gates run=`33303385616`/job=`99235504319`，29秒`PASS`。final receipt head CI=`NOT_RUN`；merge/tag/Release/生产/真实Provider仍`NOT_RUN`。

v0.6.61 PR gate：PR #130 base/head=`main@b5867b3`/`dc64f08b79eeab55b4b3e892d2ea8cec61b8c0be`，mergeable，URL=`https://github.com/jasionia1991-max/unboundry/pull/130`。final documentation head CI=`PENDING`；merge/tag/Release/生产/真实Provider仍`NOT_RUN`。

v0.6.61 GitHub identity gate：`origin/main=b5867b3edf8f39c9a58b4e77d9060e1567dd9de2`，branch HEAD=`cb9639336f87d9c31f66de1ae089d4dbfed2db22`；local/remote tag、Release与existing PR均不存在。PR diff=14个预期文件、515 insertions/26 deletions，受保护JSON未进入；push/PR/CI=`NOT_RUN`。

v0.6.61 post-commit governance：safe m38=`16/16 PASS`，失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、库存1125、source/snapshot=`607540947ee72c170aaee299ea793c0ef1c94e7ea25d4688c54a05e346214297`、HEAD=`7733464cc997053a5a66c2882a9858d570a45423`、4173 unchanged。六份治理commit=`READY`；GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 candidate commit：`7733464cc997053a5a66c2882a9858d570a45423`，tree=`692f11eae5d6ea4cb76aad40162d35fed1ab9371`，精确8文件/337 insertions/12 deletions；六份治理文档与受保护JSON未提交。post-commit governance m38=`16/16 PASS`，GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 review-go governance gate：safe m38=`16/16 PASS`，失败/重试/跳过/reportErrors0、Node22.23.1/npm10.9.8、库存1125、source/snapshot=`b5a903f87dfa67e237179cbd13850299fd580580e48cf117cb608bfcc452d150`、4173 unchanged。runner完成后外层zsh包装因只读变量名返回1，仅为命令包装诊断，不重复测试；8文件candidate commit=`READY`。

v0.6.61 third candidate independent review gate：冻结HEAD=`7f2f8d4d750fb2d4bf73cf46240166e457ab05d0`、diff hash=`8e1a52ea3a4d4795c7def721d10ad24b07e8d5bc930a8b858a557b3146732ae8`；8/8文件、30/30 hunks、337 insertions/12 deletions、10/10 logical models、11/11 exact identities、全部adapter及完整普通发布/迁移/事务/幂等链覆盖，`P0=0/P1=0/P2=0/GO`。只读限制全部遵守；Review GO治理m38=`16/16 PASS`，commit/GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 third candidate main review/freeze：8/8文件、30/30 hunks、完整迁移/schema/template/普通发布/事务/CAS/immutable revision/repeat链、10/10 logical models、11/11 exact identities及全部Provider分支覆盖；`P0=0/P1=0/P2=0/GO`。候选337 insertions/12 deletions、diff-check通过，hash=`8e1a52ea3a4d4795c7def721d10ad24b07e8d5bc930a8b858a557b3146732ae8`并冻结；独立终审=`P0_0_P1_0_P2_0_GO`，commit/GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 alias governance gate：最终六份治理同步后safe m38=`16/16 PASS`，source/snapshot=`2b3f2b699693856982b7cbd190efec2a294040adb9c0e3856e902eca29f5376f`、库存1125、异常0、4173 unchanged；取代此前`769a79cf…a32f`。精确diff/hash、主线程Review、冻结与独立复核仍`NOT_RUN`。

v0.6.61 alias remediation gate：relay与OpenRouter两个GPT Image 2 exact identities现在共同进入普通发布的代码权威合同门；exact document均可validate+publish，evidence、受支持的version-bumped connector及create path漂移均在激活前阻断。强化反例首轮`23/24`只因测试先命中既有unsupported runtime version门，修正fixture后safe m102=`24/24 PASS`，source/snapshot=`0eced92961a6d5349db749cbc214c3f759e7f5218fc1a65896e4dfb1b5b50636`、库存1125、异常0、4173 unchanged；TypeScript/diff-check=`PASS`。

v0.6.61 second independent review：8/8文件、30/30 hunks、完整链、10/10 models、11/11 identities覆盖后为`P0=0/P1=1/P2=0/NO-GO`。relay主身份已关闭；OpenRouter exact alias `openrouter/openai/gpt-image-2/native`仍可发布version-bumped connector/contract漂移。候选解冻；别名exact policy、m102回归与再次复核`NOT_RUN`。

v0.6.61 second candidate freeze：主线程复核整改与原完整范围为`P0=0/P1=0/P2=0/GO`；8文件、30 hunks、285 insertions/12 deletions、diff-check通过，hash=`6ff60ec58b2fc4557f4236e915f3297375696785908facf5a583047f487c2d71`并冻结。独立复核=`IN_PROGRESS`，commit/GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 independent P1 remediation：普通GPT Image 2发布前现在强制image/gpt-image、connector/version、runtime、EXACT evidence与完整专用执行合同，transition identity纳入evidence；三类漂移回归均fail-closed。TypeScript/diff-check通过；safe m102最终`24/24 PASS`，source/snapshot=`bb4d4df1bd931319f074f0aee1339c0f138f29e374c919db4f057266f300bd60`、库存1125、异常0、4173 unchanged；首轮`23/24`仅测试文案断言过窄。重新冻结hash与独立复核仍`NOT_RUN`。

v0.6.61 independent review gate：8/8文件、25/25 hunks、完整迁移/普通发布/事务/幂等链、10/10 models、11/11 identities覆盖；`P0=0/P1=1/P2=0/NO-GO`。P1为普通发布未在激活前强制GPT Image 2 exact registry的runtime/connector/evidence/执行合同，`EXACT→SPECIALIZED` evidence漂移可激活。候选解冻；最小修复、m102回归与同一独立复核均`NOT_RUN`，GitHub/生产/真实Provider继续关闭。

v0.6.61 main review/freeze gate：8/8文件、25/25 hunks、完整migration/schema/template/transaction/CAS/immutable revision/repeat链、10/10 published logical models、11/11 exact identities及全部Provider分支覆盖；`P0=0/P1=0/P2=0/GO`。候选216 insertions/11 deletions、diff-check通过，hash=`017c3b942ccf2a57b87e96b0f5f43d0e69e5e15e3f7f0d26cdccbe3d0446a5ea`并冻结；独立Review=`IN_PROGRESS`，commit/GitHub/生产/真实Provider仍`NOT_RUN`。

v0.6.61 final m102 gate：新增非GPT模型滥用`exact-legacy-gpt-image-2-v1`证明的阻断回归后safe m102仍为`24/24 PASS`，source/snapshot=`da861c1de482fb1b057e684dc0fbf91532400283d90c0ce5d6364617e95a34c6`、库存1125、失败/重试/跳过/reportErrors0、4173 unchanged；该结果取代`73797359…5327`作为当前m102证据。Provider POST=0/USD0，正式full未重跑；精确diff/hash、主线程Review和独立Review仍`NOT_RUN`。

v0.6.61 version/governance gate：safe m38+m81 `57/57 PASS`（16+41），source/snapshot=`c70e4e4670db0ca2e20449240f636732adb2b43c51edca89aa0fbf81eed85699`、库存1125、异常0、4173 unchanged；正式full未重跑。精确diff/hash、主线程Review、候选冻结和独立增量Review仍`NOT_RUN`。

v0.6.61 direct migration gate：精确生产legacy GPT Image 2 row+active schema、current proposed schema、v1 execution contract与完整runtime identity门已落实；row/active `referenceInputs.image=2` near-miss均阻断。package/lock/runtime/m81同步0.6.61；TypeScript与diff-check通过，safe m102 `24/24 PASS`，source/snapshot=`73797359030006eb198ac63e60dadcf8c498c921536847a08e81b986d7655327`、库存1125、失败/重试/跳过/reportErrors0、4173 unchanged。m81+m38、冻结Review、GitHub、生产迁移和真实Provider仍`NOT_RUN`。

R8增量门：生产旧published schema在Provider POST前被语义合同校验阻断，POST=0/USD0。迁移plan/apply精确执行identity/totality缺口已关闭；冻结diff `dcf8a42d…3cb854`独立增量终审覆盖8/8文件、10/10 logical models、11/11 exact identities，最终`P0=0/P1=0/P2=0/GO`。m102 `24/24 PASS`（`e93a5baf…610032`），库存1125、4173 unchanged；当前按顺序开放v0.6.58准备，生产迁移与真实Provider尚未开放。

v0.6.59的tag archive/fresh build、quiet gate和冻结备份均通过；archive=`63042cff…71b8`，staging=`v0.6.59-inc-gen-017-20260830.qjbYhr`，冻结目录=`v0.6.59-cutover-frozen.jufZ1z`，双清单=`39c9e691…ebf3`。隔离迁移副本`v0.6.59-contract-upgrade.Nz9OFg`在apply前因真实published Grok旧schema的`Invalid model reference policy`阻断，生产未写并继续v0.6.57健康；v0.6.59不可变且未部署。当前进入v0.6.60 exact legacy Grok整改；m102 exact/near-miss、版本门和独立增量Review均为`NOT_RUN`，Provider POST=0/USD0。

v0.6.60 direct migration gate：最低未占用patch身份已通过；精确legacy Grok schema与immutable revision均已由只读生产副本确认。实现只接受该exact快照、near-miss fail-closed，并对22模板/34节点保留逐节点execution比较。safe m102首轮`23/24`只暴露通用字段diff，最小收口后最终`24/24 PASS`，source/snapshot`25f82ecd…e51a2`、库存1125、异常0、4173 unchanged。版本/治理直接safe m38+m81为`57/57 PASS`（16+41），source/snapshot`07053ab1…4490b8`、库存1125、异常0、4173 unchanged；独立Review、GitHub、生产迁移和真实Provider仍`NOT_RUN`。

v0.6.60 candidate freeze：6/6产品/版本/测试文件，156 insertions/17 deletions，diff hash=`f4489901f1fa32da576e9a71c0e9ad66434c32c0a9998ec7f3a490a35e222643`，diff-check通过。独立增量Review为`IN_PROGRESS`；P0/P1门继续关闭GitHub、生产迁移和真实Provider。

v0.6.60 review gate：主线程发现`P0=0/P1=1/NO-GO`。真实active Grok execution contract v2被测试夹具错误降为v1，现有版本门会阻断真实schema narrowing；compatibility bridge还必须同时核active schema exact。候选已解冻，m102 v2 exact/active near-miss回归与独立复核均`NOT_RUN`。

v0.6.60 v2 remediation：row/active exact状态、全运行身份及execution contract等价门已落实；迁移事务只传字面证明`exact-legacy-grok-video-3-v2`，底层策略独立验证predecessor exact legacy、proposed exact current、Grok3、v2/v2与相同runtime signature，普通发布/非Grok/其他Grok schema变化的版本提升规则保持。m102真实v2、row/active near-miss、重复幂等和证明滥用阻断最终safe `24/24 PASS`（source/snapshot`fbb527b7…81ca4`），库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；前两轮各`23/24`与中间绿色`630b67aa…0357e`、`62026696…40836a3`诊断已精确关闭。扩展8文件候选重新冻结/Review仍`NOT_RUN`。

v0.6.60 remediation governance：当前树六份治理同步后的safe m38 `16/16 PASS`，source/snapshot=`df49cb21808262d3c56ae257232d81af1ac67ff5f7a073f320b32dcb5f105c10`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；前一树`3236e2bf…72dd3`只保留历史。当前8文件diff为308 insertions/27 deletions、hash=`79252797…d45a5`且diff-check通过；主线程逐链复核、正式重新冻结及独立Review仍`NOT_RUN`。

v0.6.60 main review/freeze：主线程逐文件、逐diff/hunk、逐关键分支复核8/8文件及完整migration/template/transaction/CAS/idempotence链，并覆盖10/10 published logical models、11/11 exact identities与所有Provider/protocol/adapter分支；`P0=0/P1=0/P2=0/GO`。候选以hash=`79252797…d45a5`冻结；独立增量Review=`IN_PROGRESS`，GitHub/生产迁移/真实Provider继续`NOT_RUN`。

v0.6.60 independent review gate：8/8文件、31/31 hunks、10/10 logical models、11/11 exact identities及完整migration/template/transaction/CAS/immutable revision/repeat与全部Provider分支覆盖；最终`P0=0/P1=0/P2=0/GO`。Review为只读且零测试/build/外部写；Review GO治理m38、commit/GitHub/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 review-go governance：safe m38 `16/16 PASS`，source/snapshot=`3811d4a83a62802d10581bbeb3d1b2b306bfc6ddb423bf4cc0decbc218418a66`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；正式full未重跑。8文件候选commit=`READY`，GitHub/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 candidate commit：`8be339c387ec9df21e4e6e6ee43da2f14e2ee8dc`，tree=`8179a5540fecd2b920154bb059c788080a0374a4`，精确8文件/308 insertions/27 deletions；治理文档与受保护JSON未提交。提交后治理m38=`NOT_RUN`，GitHub/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 post-commit governance：safe m38 `16/16 PASS`，source/snapshot=`fdfbe741ebb004c9d4dc8a740d2ce4217efd94d7ae9f57eabe83f2a2a108d1d0`、库存1125、异常0、Node22.23.1/npm10.9.8、4173 unchanged；治理commit=`READY`，GitHub/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 PR gate：PR #129 base/head=`main@e6341d5`/`7f34d094ec219ad15b5fd545167cbfbdbb5dd875`且mergeable；Quality gates run=`33298263718`/job=`99221554337`、35秒`PASS`。最终纯文档head CI=`NOT_RUN`，merge/tag/Release/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 GitHub gate：最终head=`76fd686996ab62bf03818e2559442c3baac80ccf` Quality run=`33298346157`/job=`99221773974`、30秒`PASS`；merge=`b5867b3edf8f39c9a58b4e77d9060e1567dd9de2`，main run=`33298393397`/job=`99221893013`、27秒`PASS`。annotated tag object=`c54cf6d107dd891d0ac689b5bd313845e5dd3e72`精确指向merge，GitHub Release v0.6.60=`PASS`。fresh build/生产迁移/真实Provider仍`NOT_RUN`。

v0.6.60 fresh-build gate：精确tag archive SHA=`8db3ed0f921a64187b2cdca7ae7c7ae6fcf7e9b2c48f6c0ee3fc3b1659790b03`；独立staging=`/opt/unboundry/staging/v0.6.60-inc-gen-017-20260830.dA88ys`，Node22.23.2/npm10.9.8，npm ci、TypeScript、Vite、6035文件inventory校验和dist33均`PASS`，inventory SHA=`d14ed3db17e1cc60b025093072a673278f191a33d48e3cbae5889275f13db6c8`。生产quiet gate/冻结备份/隔离迁移与真实Provider仍`NOT_RUN`。

v0.6.60 production-quiet gate：连续7次`active=0/unsettledUnknown=0`，current与API version仍为v0.6.57，service active/running、NRestarts0，结论`PASS`。冻结双副本、恢复验证、隔离迁移与真实Provider仍`NOT_RUN`。

v0.6.60 frozen-backup gate：正式目录=`/var/lib/unboundry-rollbacks/v0.6.60-cutover-frozen.k3xebQ`，source/restore各366，双清单=`a758e801…aea2b`，DB=`13589eea…2261`；两副本schema41、quick/integrity、FK0、任务/尝试/媒体/Canvas/模型/模板及Library计数一致，结论`PASS`。首个清单命令失败目录`v0.6.60-cutover-frozen.in7NN7`保留，生产数据未写。隔离迁移与真实Provider仍`NOT_RUN`。

v0.6.60 isolated-migration gate：工作副本=`v0.6.60-contract-upgrade.Ym2zSJ`，attestation=`75a9d74a…c87ef6`；dry-run在apply前因真实`gpt-image-2`缺reference media rules而`FAIL_CLOSED`，工作DB SHA未变、生产DB未写，失败证据=`5f68f8a7…7f6d0`。生产恢复v0.6.57健康，v0.6.60=`UNDEPLOYED`；v0.6.61 exact/near-miss整改、定向测试和Review仍`NOT_RUN`，Provider POST=0/USD0。

v0.6.58版本身份门：`origin/main@b34a6f4`未前进，本地/远端tag及GitHub Release均未占用；package/lock、final runtime和m81断言已同步。生产仍为v0.6.57/schema41，版本定向m81+m38待执行。

v0.6.58版本直接门最终有效`57/57 PASS`：m81 `41/41`、治理m38修正版本字段后`16/16 PASS`（`30e11dbd…c7d7b`），库存1125、异常0、4173 unchanged；候选提交就绪。

提交前最终治理safe m38 `16/16 PASS`（source/snapshot`79ae8703…609cd6`），库存1125、异常0、4173 unchanged，精确diff-check通过；`b577…`早期候选的12项P1已在本矩阵既有整改/复核证据中闭合，不回退当前`dcf8…`热修Review GO。随后仅回写本条证据。

v0.6.58功能/版本候选commit=`760dfcf131d5800f8e03e8533199ef1e773a7ea3`、tree=`dc8c192e27acf6373899a959e9cc0d4a22f86e3e`，18个安全文件；受保护JSON未进入提交。提交后治理m38与治理commit待执行。

提交后治理safe m38 `16/16 PASS`（source/snapshot`1b906cf7…968f79`），库存1125、异常0、4173 unchanged；随后仅回写该证据，治理commit就绪。

PR #127 head`0226d77`的Quality gates / lightweight已通过（run`33273711037`、job`99156654353`、31秒）；只回写该证据并等待最终纯文档head同一CI门。

PR #127最终head/main CI通过，merge`730ea56`、annotated tag object`959dbc9`和GitHub Release v0.6.58已冻结。精确tag archive`85cfe65e…ffe5b`的fresh build通过：Node22.23.2/npm10.9.8、6035文件、inventory`37b52e73…16bb8`、dist33。生产迁移待执行，Provider POST/费用仍为0。

v0.6.58冻结恢复副本dry-run在apply前因真实legacy Mureka歌词8000/outputCount1/2/3未获迁移核准而fail-closed；备份双副本、schema/integrity/FK/计数门均有效，生产恢复v0.6.57健康且v0.6.58未部署。v0.6.59整改状态：精确legacy Mureka收敛+semantic revision核准、畸形反例fail-closed，定向/Review待执行。

v0.6.59迁移直接门：safe m102最终`24/24 PASS`（source/snapshot`c00a705d…ed955`），精确legacy lyrics8000/outputCount1/2/3只收敛为lyrics8000/单结果1；畸形1/4阻断、apply幂等、mureka-native contract v1/v2读取通过。库存1125、异常0、4173 unchanged，Provider POST/费用0；m81+m38与独立Review待执行。

v0.6.59版本/治理门m38+m81 `57/57 PASS`（source/snapshot`6848e45b…ff3f`），库存1125、异常0、4173 unchanged；7文件diff `d58b6101…d702`、diff-check通过。候选已冻结，独立增量Review待执行，P0/P1门仍关闭GitHub/生产。

v0.6.59独立增量Review最终`P0=0/P1=0/P2=0/GO`：7/7允许文件、14/14 hunks、10/10 published logical models、11/11 exact identities及完整migration/transaction/idempotence链全部覆盖。当前生产、冻结source、restore三份DB的SHA256同为`54468f…12aded`，published Mureka合同均为lyrics 8000与outputCount 1/2/3；该只读生产证据撤销了按Git历史5000提出的首轮P1。Review硬门通过，治理m38与精确提交待执行。

Review GO治理m38 `16/16 PASS`（source/snapshot`0cce774d…799a`），库存1125、异常0、4173 unchanged；diff-check通过且正式full未重跑。7文件精确提交待执行。

v0.6.59产品/版本候选commit=`6abe72b72b496de08a7309948b3b3ee06df54652`、tree=`25b4a00d19cead0a5ef8080e89db6795543654aa`，只含7个安全文件；治理文档和受保护JSON未提交。提交后治理m38待执行。

候选提交后治理m38 `16/16 PASS`（source/snapshot`25c7a168…7bf9e`），库存1125、异常0、4173 unchanged；正式full未重跑，六份治理文档提交待执行。

PR #128已创建，base/head=`main@730ea56`/`61f5b2b`；当前open，最终治理head CI待执行。首次TLS push失败未改变远端，原分支重试后成功。

PR #128 head`f575836`的Quality gates / lightweight已通过（run`33295091931`、job`99213263004`、48秒）；只回写本条证据，最终纯文档head CI待执行。

PR #128最终head`944ae9b`与main CI通过，merge=`e6341d5`；annotated tag object=`52308b6`精确指向merge，GitHub Release v0.6.59已发布。tag fresh build与生产迁移待执行。

| ID | 验收项 | 必须证据 | 当前状态 |
|---|---|---|---|
| IG17-001 | 同画布不重叠组互不阻塞 | A组interrupted时B/C组可启动；各自run/lease/task计数独立 | R1_TARGETED_AUTO_PASS |
| IG17-002 | 同组自动接管原run | 刷新/重连后无需再次点击；不新建并行run；页面无需任务面板操作 | R1_TARGETED_AUTO_PASS |
| IG17-003 | 零accepted且不可修复自动收口 | checkpoint只按精确run清理；下一轮可直接开始；Provider POST=0 | R1_TARGETED_AUTO_PASS |
| IG17-004 | accepted原任务只恢复不重提 | 刷新/重启/双击后同taskId；新Provider POST=0 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-005 | accepted恢复后安全继续pending | snapshot一致才继续旧run；变化时关闭旧run、当前图新run自动继续 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-006 | 部分失败只阻断后代 | 独立分支继续；成功proof保留；失败分支可恢复 | R1_TARGETED_AUTO_PASS |
| IG17-007 | 同组多run冲突安全 | 仅核对已有任务、禁止新POST；其他组不受影响 | R1_TARGETED_AUTO_PASS |
| IG17-008 | outcome unknown费用围栏 | 任意点击/刷新/worker循环都不产生新paid attempt | R1_TARGETED_AUTO_PASS |
| IG17-009 | 明确退款/未受理最多安全重试一次 | 持久retrySafetyDecision和attempt/POST精确计数 | R1_TARGETED_AUTO_PASS |
| IG17-010 | 结果成功与Canvas投影解耦 | 投影冲突时asset/task成功保持，后台只重试投影 | R1_TARGETED_AUTO_PASS |
| IG17-011 | Seedance纯文字模式 | 无媒体唯一选择text，Provider前合同通过 | R3_TARGETED_AUTO_PASS |
| IG17-012 | Seedance单图全能参考 | 一图自动为multimodal/reference-image，不出现ROLE_UNSUPPORTED | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-013 | Seedance多模态全能参考 | 图/视频/音频按各自参考角色完整消费 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-014 | Seedance首尾帧 | 明确两图首尾角色、顺序、数量和请求映射正确 | R3_TARGETED_AUTO_PASS |
| IG17-015 | 首尾帧→全能参考原子迁移 | node参数和edge角色同一undo/save；媒体/边/order不变 | R3_TARGETED_AUTO_PASS |
| IG17-016 | 模型切换无半状态 | 保存失败回到切换前；成功后旧contract错误被清除 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-017 | 无法无损迁移时精确阻断 | 所有素材和边保留；Provider POST=0；错误指出具体原因 | R2_TARGETED_AUTO_PASS |
| IG17-018 | 共享语义与独立adapter一致 | 同revision语义/fingerprint一致；Canvas/Provider各自适配；漂移fail-closed | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-019 | schema合法组合全部唯一编译 | 每个published revision合法组合命中execution mode恰好1条 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-020 | 无未消费字段/角色 | compiler消费清单与schema输入全集相等 | R4_TARGETED_AUTO_PASS |
| IG17-021 | Grok合同闭合 | UI合法的每个模式/角色都有精确执行路径；无证据能力不可选 | R3_TARGETED_AUTO_PASS |
| IG17-022 | Mureka固定单结果 | UI/API/task/adapter/result asset均为1；2/3不可配置 | R3_TARGETED_AUTO_PASS |
| IG17-023 | 专用adapter精确注册 | 每个specialized模型绑定revision/mode/roles/parameters/results | R4_TARGETED_AUTO_PASS |
| IG17-024 | 未知模型不靠通用兜底发布 | 只有protocol、没有精确合同的假模型发布被拒绝 | R5_FUTURE_MODEL_AUTO_PASS |
| IG17-025 | 当前全部published模型覆盖 | 实施时真实清单逐一有schema/compiler/adapter/result/recovery证据 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-026 | 动态N×N有向模型切换矩阵 | 从真实published快照生成；当前10模型全覆盖；新增模型自动进入 | R5_DYNAMIC_MATRIX_AUTO_PASS |
| IG17-027 | 旧Canvas兼容 | v1 checkpoint、旧edge角色只按需无损规范化，不批量改图 | R2_TARGETED_AUTO_PASS |
| IG17-028 | 旧任务/revision兼容 | 历史任务按冻结connector/revision/profile/credential恢复 | R6_FAULT_AUTO_PASS |
| IG17-029 | 安全边界不回退 | owner/run/task/ownership/node/kind/revision/CAS与SSRF/secret门通过 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-030 | 浏览器三组真实规模fixture | A可恢复失败、B/C继续、Seedance自动迁移，下游全部完成 | R7_COMPOSITE_BROWSER_TARGETED_PASS |
| IG17-031 | 风险定向回归 | 新spec和直接依赖全绿，命令/环境/源码hash/异常数完整记录 | R7_TARGETED_REGRESSION_PASS |
| IG17-032 | 唯一正式safe full | 仅候选冻结+Review GO后按风险执行一次；原始结果诚实记录 | CONSUMED_FAILED_1023_PASS_95_FAIL_4_NOT_RUN |
| IG17-033 | 独立终审 | 冻结候选P0=0/P1=0/GO | REMEDIATION_REVIEW_P0_0_P1_0_P2_1_GO |
| IG17-034 | GitHub/不可变发布 | 当前Goal已授权：PR/main CI、tag/Release、fresh build | V0_6_61_GITHUB_RELEASE_FRESH_BUILD_PASS |
| IG17-035 | 生产备份/恢复/回滚 | 当前Goal已授权：冻结备份、恢复副本、原子切换、稳定门 | PRODUCTION_TECHNICAL_PASS |
| IG17-036 | 真实Provider最小验收 | 当前Goal累计USD100内已授权；unknown禁止第二POST | AUTHORIZED_NOT_RUN |
| IG17-037 | 用户实页验收 | 产品发布后由用户按五步清单确认；当前尚未实施 | NOT_RUN |
| IG17-038 | checkpoint降为缓存 | 缺失/损坏/清空后由Canvas绑定+服务端task重建；无关组不阻塞 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-039 | snapshot变化安全自动续作 | accepted只恢复原task；旧pending POST=0；当前图新run自动继续 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-040 | Canvas模型切换真原子 | 一个before/after图事务、一个undo、一个保存版本；失败完整回滚 | EIGHTEENTH_REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-041 | 三层边界无过度耦合 | 共享语义层无React/HTTP；UI无Provider字段；adapter不改Canvas | R2_BOUNDARY_REVIEW_PASS |
| IG17-042 | 用户通知不骚扰 | 30次轮询最多1个中性状态；恢复成功红错0；终态红错最多1 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |
| IG17-043 | 结果不去外部找 | 正常结果自动回原节点；普通UI无Provider URL/task ID/外部核对文案 | R6_EXPERIENCE_REVIEW_PASS |
| IG17-044 | 不可恢复失败诚实收口 | 不换模型、不改Prompt、不绕审核；仅受影响分支终止且其他结果保留 | R6_FAULT_AUTO_PASS |
| IG17-045 | 当前模型先注册再关兜底 | 全部published显式registry+零Provider shadow一致；历史runtime保留 | R4_MIGRATION_REVIEW_PASS |
| IG17-046 | 灰度回退不放宽安全 | 两个V2开关可止损；unknown始终零新POST；稳定后有清理门 | REMEDIATION_TARGETED_PASS_REVIEW_PENDING |

说明：历史候选与唯一正式full原始结论不改写。第十九候选两路完整只读终审曾合并为`P0=0/P1=0/P2=1/GO`；随后唯一正式full暴露`95 FAIL / 4 NOT_RUN`并永久消费。现27个失败spec及4项NOT_RUN均已逐项执行闭合；最后m73 `16/16`、m77 `11/11`，合计`27/27 PASS`，source/snapshot`720b0ea6…a9499c`，异常0、4173 unchanged。失败映射P1已关闭，但整改后独立增量终审仍待执行；GitHub、版本、生产和真实Provider仍未运行，Provider POST/费用仍为0。

冻结证据：六份治理同步后safe m38 `16/16 PASS`，库存1124、source/snapshot`7246af43…45b11`、异常0、4173 unchanged；产品/测试候选以`720b0ea6…a9499c`冻结，当前仅等待独立只读增量终审。

独立增量终审最终覆盖96/96个安全范围改动文件（产品/类型60、测试36）及六份治理文档，结论`P0=0/P1=0/P2=1/GO`。P2仅为legacy terminal reconciliation未显式消费cache corruption信号；零新task/Provider POST且有现存admission/scope/fresh-match围栏，已登记为非阻断。R7现可开始，正式full不重跑。

R7组合浏览器证据为m22 `44/44`、m68 `4/4`与最终m30 `13/13 PASS`，有效合计`61/61`；m22覆盖三组真实规模fixture、失败/停止/刷新与零重复task，m68覆盖任务面板/兄弟组恢复，m30覆盖Seedance遗留首帧角色原子迁移。最终m30 source/snapshot`5fc0da23…8d35`，失败/重试/跳过/reportErrors0，4173 unchanged。首轮`60/61`仅为测试断言落后于更严格的产品上传门；只对齐断言后通过。此证据标为组合验收，不宣称单一monolithic场景。

R7治理safe m38随后`16/16 PASS`，库存1124、source/snapshot`26bbf3a8…82c3`、异常0、4173 unchanged；R8前置治理门闭合。

R8版本门已确认`v0.6.57`为最低未占用patch；origin/main与基线一致，本地/远端tag和GitHub Release均未占用。package/lock与final runtime版本门已同步，生产仍为v0.6.56/schema41；版本定向测试待执行。

版本safe m38+m81 `57/57 PASS`，source/snapshot`2e0c5fee…0c3a5`、库存1124、异常0、4173 unchanged；候选提交前治理m38待执行。

候选提交前治理m38 `16/16 PASS`，source/snapshot`d82e3545…b945b`、库存1124、异常0、4173 unchanged；本地候选提交就绪。

v0.6.57功能候选已提交为`46a9abf`，tree`43825c5e…9a4c7`；两份受保护JSON未进入提交。治理commit、push和PR待执行。

候选提交后治理safe m38 `16/16 PASS`，source/snapshot`a52ff92c…92527`、库存1124、异常0、4173 unchanged；六份治理文档提交后进入push/PR/CI。

治理commit`0941fc5`已推送，PR #126已创建并处于mergeable；GitHub Quality gates正在运行，tag/Release尚未创建。

PR #126 head`d153b61`的Quality gates已通过（run`33269246033`/job`99144636759`）；最终纯文档head检查通过后即可合并。

PR #126最终head/main CI通过，merge`b34a6f4`、annotated tag object`9e428c31…5e824`和GitHub Release已冻结。fresh tag build为6035文件、inventory`321256ab…c7581`、dist33；冻结备份双副本366/366、清单`73ac36da…835d`，恢复standby通过。生产v0.6.57原子切换、回滚/前向、33/33静态、schema41/integrity/FK0、数据不变和72秒稳定门均通过；真实Provider待执行。

生产技术治理m38最终`16/16 PASS`，source/snapshot`7aac68cc…833af`、库存1124、异常0、4173 unchanged；首轮单一治理标记诊断已精确关闭，正式full未重跑。
