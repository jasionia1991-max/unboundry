> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# Unboundry Canvas Document Write Boundary 实施 Checkpoint

## v0.7.11 正式全测1243通过，发布前文档增量6/6复核GO（2026-09-05 14:32 UTC）

- session95805：127 specs、1243/1243 PASS，exit0，failed/skipped/retries/blocked/reportErrors全部0；Node22.23.1/npm10.9.8，14:04:22–14:32:15Z。source/snapshot均为deb4575d5dd84a276db0a3ce6b292927a4890080e1d615c8ff38de9f0b643b7c，snapshot/4173 unchanged，结束后161冻结文件漂移0。完整日志与终态已落盘，摘要/tmp/unboundry-v0711-candidate.JEYZZf/formal-full-final.json；日志SHA245472e0586c78b6a44fee678ee5229d22dc1145a81108f6f73b254f84288008。
- 原session48203最后观测13:28:50Z；原任务随后遇到model-capacity compaction错误。现无原进程/session或残留summary，不能标PASS，也不认定产品失败。冻结161文件未变，在记录该不可恢复基础设施/证据中断后只补跑上述一次，累计invocations2、可确认完整终态1；原RUNNING记录作为历史保留。禁止因下面文档/运维修改重跑已成功full或255定向。
- 独立代码全审仍为161文件/1241hunks/257writers/194CWB/10模型/12identities/6adapters、P0/P1/P2=0。当前只同步full结果与明确当前状态，post-full文档增量6/6 Review已GO，155文件不变、P0/P1/P2=0，仅机械回填结论后commit/push/PR/CI/merge/tag/Release。
- 14:17Z线上只读核验079/schema43/PID489226/NRestarts0；active task/run/publication/current unknown均0、startup写候选0。目标revision95/input58、task1075/attempt1086/run8/asset983/receipt17不变，原11/11结果保留且不得重跑。容量helper的原P1/P2已关闭为条件设计GO；新mirror/maintenance脚本还在有界复核，均未执行。新0711发布、备份恢复/回滚部署、刷新、真实音频/三上传和最终生产复核仍待完成。

以下区块保留此前时点，不再代表全测正在运行或当前阻塞。

## v0.7.11 冻结终审GO，进入唯一正式全测（2026-09-05）

- 原Reviewer已完成5/5文档增量复核，其余156文件hash不变；首轮治理P1/P2全部CLOSED，最终P0=0/P1=0/P2=0/GO。完整分母161/161文件、1241/1241 hunks（unified=3）、257/257 writers、194/194 CWB、10模型/12 identities/6 adapters、遗漏0、保护文件访问0。doc-v2 entriesSha256 d3a3d4279c14929aebff3576191e654898f6bdec239c02f5036d4b48d5a271de；HEAD增量25文件/173hunks。
- Reviewer明确允许仅回填本次审查结论后执行唯一mandatory formal full。本轮只做该结论回填，产品/测试/运行时不变。下一命令 /Users/mymy/.hermes/node/bin/node scripts/run-safe-tests.mjs full，127specs/1243库存；结果尚待取得，不能提前标全测或R9通过，不重跑255项定向求安心。
- 当前审查与运行证据保存在/tmp/unboundry-v0711-candidate.JEYZZf；正式运行期间候选不改动。0711生产发布/备份恢复/回退/刷新/音频/三上传与最终生产Review仍未执行，原11成功组不重跑。下面首次NO_GO是已关闭的历史过程，原证据保留。

## v0.7.11 首次冻结Review返回，文档增量修正（2026-09-05）

- 上个交互只是状态汇报，NO_PROGRESS；本轮独立Review已返回：161/161文件、1241/1241 hunks（unified=3）、257/257 writers、194/194 CWB、10模型/12 identities/6 adapters，遗漏0，保护文件访问0。134个未变文件明确复用，27个变化文件逐项复核；产品无新增finding，但治理P1=1/P2=1，原结论NO_GO，未启动formal full。
- P1是Matrix错误继承旧候选/0710生产AUTO_PASS；本轮将0711候选171..176、release/backup/deploy/refresh/rollback门置PENDING，R9重置当前1243库存待验。原组186..190明确HISTORICAL_AUTO_PASS，只证明既有唯一执行窗口，不得重跑。P2是Plan/Matrix m38仍待验，已更正最终19/19。175按当前Goal要求P0/P1/P2全0，178明确本Goal已授权最小未占用普通patch；原历史结论不再冒充当前。
- 产品/测试/运行时版本未再改变，不重复已通过255项业务测试；当前只重新冻结这5份文档并交原Reviewer增量复核。新formal full、发布及完整生产技术门仍未执行。外部只读备份准备见/tmp/unboundry-v0711-candidate.JEYZZf/release-gates.md：629素材、95/58原11结果保留，磁盘顺序峰值需独立操作审查和停服前再核，不能据估算停服。

## v0.7.11 版本门通过，进入冻结候选独立Review（2026-09-05）

- 本轮PROGRESS：版本登记及反例测试完成；safe session22103原始60/61保留，其中m81 42/42 PASS（35.4s），仅m38的AGENTS生产标记失败。修正文档后仅复验m38，session49793 exit0 19/19（4.1s），failed/skipped/retries/blocked/reportErrors0，source/snapshot 87fefd52eff2c89a4ce5efd43d3080905a84ede2023f59edd99d48c9c11381dd，906文件、127specs/1243库存、snapshot及4173不变。没有重跑已通过m81或89/91/14业务测试。
- 有效定向覆盖255项（89+32+59+14+42+19），不是formal full；writer257/0violations，hash90b850d28d1f82b05725c2738b889bd56d86b985c14043cd134d21369fd1ee06。冻结清单准备于/tmp/unboundry-v0711-candidate.JEYZZf，包含原Goal基线至当前每个文件/hunk及当前HEAD增量，禁止访问两份受保护JSON。
- 后续只读独立全量Review，候选期间不修改工作树；通过后唯一新formal full，再执行完整不可变发布及最新数据备份/恢复/回退/上线/真实音频/三上传/刷新/最终生产Review。生产079 active，原11成功组不重跑；Goal active，未达到完成条件。

## v0.7.11 版本登记（2026-09-05 12:40 UTC）

- 上一个交互为状态答复，NO_PROGRESS；本轮已推进 package/lock、exact final 运行时版本和反例测试。当前分支 codex/v0.7.11-canonical-generation-boundaries，HEAD 1443d69a40db666b5b932f4769e53e46b9ea4173，工作树保留全部本地修复及回执。
- v0.7.8/9/10 已占用；0711 本地tag/远端tag均不存在，GitHub Release 返回 release not found。新增0711明确final/拒绝bridge、0712及版本后缀拒绝测试；仅跑直接相关safe m81/m38，已有89/91/14业务证据不为版本登记重复运行。
- 用户再次明确允许已有素材只读加载；刷新仍要求新增生成、上传、Canvas写入为0。生产只读确认仍079 active；无新生产写入，原11/11成功组唯一点击已消费，禁止重跑。候选冻结/独立全量Review、新正式full及剩余完整生产门尚待完成。

## 当前本地修复断点：Text 89/89、参数与源输入32/32、四节点恢复59/59、TTS实际HTTP14/14；候选Review/正式全测与生产门待完成

- TTS browser→actual API→loopback fake Provider→真实本地publication/projection→reload已PASS，safe session37965 exit0，m104 14/14、failed/skipped/retries/blocked/reportErrors0，17.8s；127specs/1243库存中执行1spec，906文件source/snapshot 2ea0dc91d64b7224665e0426bd22afedfc745db53826bd87b29609905c46beb3，snapshot/4173不变。精确默认mp3/emotion auto/speaker/speech_rate payload无隐藏UI键，一次task/ProviderPOST/attempt1，DB provider_task_id/result_asset_id对应Canvas asset/groupRunSuccessTaskId；refresh节点/revision不变/API写0/4090。
- 新TTS测试的79282类型错误0-run、68543无project元数据13/14、90558 seed缺observed pair13/14、17944 fake缺task_id导致recovering及后续上下文干扰9/14均保留于回执。17944两次api.lk888.test意外fetch被guard拦截，真实外网0；同一Reviewer指出mock async合同错误，主代理以真实cleanMediaRequest核对并修正，不把providerProtocol误加wire payload。正确的task_id→skills404→media-status→audio链复验14/14后全部关闭。
- self模式已有浏览器用例，runner仅将self加入既有受控browser复制条件；网络/文件隔离未放宽。writer257/0violations，sourceTreeHash e47b1492bc6cc0b4d23c63342d1ebde674d77afa67131d6f2c9a9864727f412a。下一动作：未占用版本核验与候选冻结、独立全量Review、新正式full、不可变发布及完整生产门；真实音频/三上传/最终生产Review仍未通过。以下“TTS待验”为本轮早期时点。

- 上一Goal turn仅状态答复，NO_PROGRESS；本轮实际修复并完成隔离复验，PROGRESS。先前m41 session64030为58/59（源码b3006b46…d028），保留真实P1：catalog延迟时上游已编辑，projection conflict旧Text结果仍覆盖当前body。未放宽此断言。
- 新增共享catalog-independent source/edge/order/ownPrompt变化围栏，四节点bound恢复接入；不重算opaque ownership，不自动清task/intent/server binding。Text现代结果仅显示已读取的权威Canvas，conflict/pending不得从task.resultText写显示。参数未知仍允许原任务GET及既有服务端投影读取。
- safe session11332 terminal exit0：m102 32/32、m41 59/59，合计91/91，failed/skipped/retries/blocked/reportErrors0，Node22.23.1/npm10.9.8，127specs/1242库存中执行2spec；m41动态42160/49169。906文件source/snapshot SHA均8749ab2c90d485cfc60f5c1340f8cd2c6e800eaac5ff1f0a18bb5e9ab6e22c46，snapshot及4173不变，无真实Provider/OSS。完整命令及历次失败见0711本地回执sourceFenceVerification。
- writer 257条/0violations，sourceTreeHash 937647558c9cf5f42987090ac8b9a654c3f6b948b13365d46f8df03ad90334a0。不是最终Review/formal/生产PASS。下一步真实公开TTS schema的browser→actual API→fake Provider创建/结果/刷新，随后完整冻结Review、formal、发布和生产全门；原11成功组不重跑。以下56/59为保留的早期验证记录。

- 新分支`codex/v0.7.11-canonical-generation-boundaries`，HEAD仍1443d69；0711本地/远端tag为空、Release not found，package尚未版本化。原有文档变更保留。
- 独立Reviewer确认Text窄修设计GO。已复用`storedRichTextValue`规范化stored baseline进行比较，不改server bytes/清journal；新增modern command-v1与legacy各一条生产编码形状hydrate→pagehide→reload零写用例，保留格式编辑和IME路径。
- safe m86 session81450因新增测试类型错误在产品用例前退出，已修；96286因一次managed-timeout负向门kill EPERM退出，无匹配进程残留，不改安全门。相同源码9747 terminal exit0，89/89、failed/skipped/retries/blocked/reportErrors0，127specs发现库存1241但仅执行1spec；临时数据/dynamic55674/59324，source/snapshot=`8c1dd7d82159989455514669b201902b3b7e28d8a3a27ba7ae3f1f3627220cf3`，4173不变。不是formal full，不重跑已通过专项求安心。
- writer manifest257条/0violations（新增1条m86 commands route test double，纠正此前“事件producer”表述，无新产品writer）。当前sourceTreeHash `aefb8f5e5b02e60554202df126dfa21d56bf4fe102ba8ba617d74d2a0951b64a`；最终冻结Review未运行。
- 同一Reviewer已撤回server误判并确认Plan R10 item5 DOCUMENT_GO/P0/P1/P2=0。已实现共享boundGenerationParameterProof及四节点canonical unbound/opaque bound初版；不新增server字段、不改变Provider协议、不清旧浏览器journal。
- safe m102 session64943 terminal exit0：32/32，失败/跳过/重试/阻断/报告错误0；906文件源码SHA `e31396d2c6e9b447eb3c3a6fa175a88da7551e2bc52c9c7427d639328a2926e0`。证明共享参数三态规则，不证明完整TTS创建链。
- safe m41 session17332 terminal exit1：56/59，3失败、其余异常计数0，临时端口56485/44850，源码SHA `bb5e2e2a8b52b32ebe6e9139e8cbe8de4eacf9de4c5f3618bcf1042ef511994f`；snapshot及4173不变。失败：1912初始Canvas读取ECONNRESET；2840 Image取消→改prompt→Generate超时（恢复了旧generating视图）；6978上游Text编辑后本地intent保留而旧断言期望清除。前两条trace/context已保留`/tmp/unboundry-v0711-m41-failure.LaPKqb`；同一Reviewer只读诊断后两项语义问题，不是最终Review。
- 本轮由状态答复no progress转为实施与验证PROGRESS。下一动作：关闭上述失败（只最小复验），补catalog就绪后的恢复依赖，完成真实TTS合同的浏览器→实际API→fake Provider创建/结果/刷新用例。随后候选冻结Review、唯一formal、不可变发布和生产门，完整Goal不缩减。生产未改、已成功组不重跑。

## 11:00 UTC 当前断点：已无损回退代码，进入下一补丁

- 上一Goal turn仅汇报状态，判定no progress；本turn已实际完成已审回滚，不重复业务测试。远端v2数据核对helpers精确SHA匹配，0710/079逐文件inventory分别6129/6126项exit0。
- 普通Chrome管理员10:58:24.480Z临时冻结新生成，等待60秒；controller session19803 terminal exit0，停服writer/quiet门通过，新增当前schema43数据库备份（37064704 bytes，SHA `ca8f16e5ba8376b2dfdc81ef0ae71af48865531741663ff148831b4213b25bc4`），只切code pointer至079，不恢复覆盖DB。37表added/removed/modified=0，媒体/secret文件树变化0，原unit/环境保留。
- 当前生产079/schema43/PID489226，ready request `f72dd113-ccc8-4790-b1cc-08c83e09a420`；11:00:30.079Z经原UI恢复global1/emergency0/wait并只读核对，目标95/input58不变，成功组不重跑。079是schema43兼容code fallback，不是缺陷已解决或生产验收通过。
- 权威新增回执 `spec/V0_7_10_POST_FAILURE_CODE_ROLLBACK_RECEIPT_2026-09-05.json`。下一动作是0711文本规范化比较及四类单节点canonical参数identity窄修，保持已绑定任务/旧journal，独立设计复核后实施；音频/三上传/结果刷新/最终Review尚未完成。

下方10:20及更早段落为保留的历史时点，不代表当前运行版本。

## 10:20 UTC 当前断点：真实组成功，音频与结果后刷新 NO_GO

- run `10e1664e-32dc-4e67-8573-34b95e8336a0` 10:10:49.670Z成功：11/11 nodes/task/admission/providerAttempt，全部attempt1/completed/projection applied；7text/3image/1video、4媒体publication、revision84→95/input58不变。网络955 events/321 request events/317 IDs/4 redirects：GET320/POST1、200315/2021/2061、失败0/Canvas写0/4090/truncated0。终态UI四图complete/video4/status0/alert0。唯一点击已消费，禁止重跑。
- 自有验收Canvas `4349f70d-34f9-4bef-869c-9d40965e030e` 标记`v0.7.10 CWB 生产技术验收 2026-09-05`；音频node `audio-0c448916-c3e0-4556-86bb-3d95baa48e7b` Doubao TTS2.0单击，preflight200，submit `49684a29-d377-4056-bd17-fc4cc62749d4` 409/WORKFLOW_BINDING_MISMATCH。精确idempotency `637d34ad-cd39-4bd0-ac9d-e10b12d28f35`；DB该Canvas tasks0，未进入Provider、未重试。独立Reviewer只读检查音频identity规范化直接链，尚未最终生产Review。
- 10:13:59.812Z结果后暖刷新NO_GO：CanvasGET `69635.666` / `a4135952-865e-470c-917c-a3770e131630` 71.84ms成功，后续`69635.673` commands不是读取超时，而是pagehide journal重放6个text `data.contentHtml`；6003ms abort、hydrate failed。服务器HTML含`&quot;`/`&#39;`，TextNode DOM sanitize序列化为原字符，CanvasSurface:3090–3146原始HTML比较将显示差异认作用户编辑；没有实际用户正文编辑。必须修事件/比较边界，不得继续加大读取deadline掩盖。
- 结果刷新前后DB95/input58/nodesSHA `5afe24fdc6654a41ba6e40122d3648caaecf9c220974dd7ec16b0ea4e7788c6f`完全不变；tasks1075/admissions995/attempt1086/run8/media983/publication574/receipt17不变。10:20只读preflight确认active/unknown/unsettled/run/publication/deletion/unadopted-upload/projection candidates均0。尚未操作生产回滚、安全设置或修改已发布产品。
- 完整汇总`/tmp/unboundry-v079-runtime-drill.YqH6MK/v0710-real-production-outcomes.json`，原网络在CUA captures，远端`group-run-2026-09-05T10-11-52-472Z.json`与`result-refresh-before/after-database.json`/`result-refresh-structured-journal.json`。任务结果、音频拒绝、浏览器journal和失败不清理。
- 下一安全动作：取得音频明确cause，冻结R10窄修设计及schema43无损code-only回滚操作增量，独立设计GO后执行回滚/修复；下一未占用patch严格重走候选/定向/Review/唯一formalfull/发布/生产门。079是已审schema43-compatible fallback，不声称其解决刷新；077不能打开43也不能回灌旧42。若code rollback无法保持全部新数据则不执行破坏性回滚。音频/三上传/结果刷新/最终生产Review仍未通过，Goal active。

以下10:04运行中状态是历史；实际整组已成功，整体生产验收仍NO_GO。

## 10:04 UTC 当前执行断点：0710上线、刷新通过、唯一整组执行中

- 当前生产`/opt/unboundry/releases/v0.7.10-canvas-read-deadline-20260905`，schema43/PID468648/NRestarts0。已发布产品未变，formal1239/1239与158文件独立Review有效，不重跑。
- attempt2操作增量3/3文件独立GO/P0/P1/P2=0；UI audit346于09:37:58.941Z冻结，controller唯一执行exit0，实际079停止→最新43备份→077隔离42实际service回滚→0710 CURRENT43前进。原unit/dropins/env哈希恢复，临时99配置移除并保留证据；09:42:22.796Z恢复global1/emergency0/wait。
- 最新locked-exact43 backupId=`5178b05f-7d1b-4eee-94a4-853d6ea09b81`，logicalSHA=`dc6c325bc59c3961b77acf298b27cdaef5ed65f94cb858ebe653daf629788ba4`，官方verify/fresh restore成功；355媒体/3secret/625OSS，原97个非阻断历史问题逐条不变。37表removed/added/modified均0，media/secret树变化0，无DB恢复覆盖。33/33本地与公网静态匹配。证据根`/var/lib/unboundry-v0710-maintenance-20260905/evidence/`，核心`attempt2-latest43-complete.json`、`attempt2-live-maintenance-complete.json`、`public-static0710.json`。
- 冷1早期网络buffer截断明确NOT_PASS并保留；修复采集后同版本冷2（09:46:40.958–09:48:34.694Z，113736ms）及暖（09:50:36.055–09:51:10.393Z，34338ms）均有完整network+structured journal+DB证据，settle后30秒，4图complete/视频ready4，无alert/误报。每次5个允许的OSS GET/Range，Canvas写/409/workflow/task/admission/attempt变化均0，revision84/input58保持。冷2初期DOM探针不支持performance导致的25次采集错误明确保留；移除该探针后同次刷新完成，不冒充应用错误。暖缓存启用且有revalidation，不声称disk-cache命中。全账本`/tmp/unboundry-v079-runtime-drill.YqH6MK/refresh0710-browser-ledger.json`。
- **唯一点击已消耗**：10:02:20.299Z普通Chrome目标组点击一次，浏览器`69635.332` POST `/api/workflow-runs`返回202；run=`10e1664e-32dc-4e67-8573-34b95e8336a0`（创建10:02:22.054Z），11执行节点。10:04:07样本首文字task=`040437fb-d200-47a0-8375-09eca1c2e552`/attempt1101 completed且projection applied；首图task=`1b00cf84-8b0f-4362-9d11-e52cfee80332`/attempt1102 response-received/Provider127328822正在运行。仅跟踪原run/task，绝不因慢/未知再次提交。Canvas85/input58为首个合法服务端结果投影，不是刷新保存。
- 下一动作：持续核对原11节点run、每节点单attempt及自动投影/呼吸灯终态，再做结果后刷新。随后独立版本标记验收Canvas完成真实音频、三类自有fixture上传和下游输入，最后冻结生产证据交原独立Reviewer全量复核。Goal仍active，不能提前完成。

以下状态与断点均为此前历史时点，不再表示当前生产版本或允许再次点击。

> **09:27 UTC 最新事实**：第一次维护已实际执行：UI audit344冻结、停079、官方backup在产出任何package前报`BACKUP_MEDIA_WARNING_NOT_ALLOWED`；未进入old077或0710。fallback已恢复079/current live43，原unit配置恢复，PID463401/NRestarts0、公网ready43、任务1064/attempt1075/run7/media979/receipt2及目标84/58不变。控制器Type=simple启动后立即查/proc遇到exec过渡期而误报identity，稍后已实证exact079 cwd/Node22 exe。UI audit345于09:27:33.900Z恢复global1/emergency0/wait。未恢复覆盖任何DB快照，真实生成/上传0；最新43备份和实际回退前进整体仍未通过。根因是维护caller误传warning-only可选参数，97个历史nonblocking issue含56个severity error；下一attempt2只使用官方default backupComplete硬门并逐条固定这97项，不清理历史。新增独占attempt2 helper/evidence及5秒exec过渡观察进入有界独立复核，原helper/失败证据全部保留。下方“未停服”仅为此次维护前历史时点，formal1239不重复。

状态：`V0_7_10_DEPLOYED_SCHEMA43 / REAL_GROUP_11_OF_11_SUCCESS / AUDIO_CONTRACT_409_AND_POST_RESULT_REFRESH_NO_GO / REAL_CLICK_1_OF_1`

## 最新执行断点：0710发布与未激活安装完成（2026-09-05）

- 后续准备实证：新case根已从初始ubuntu0700加固为root:ubuntu0710，evidence root:root0700，工作子目录仍ubuntu0700；没有改旧数据/keys。backup controller首次审查P1目录替换/P2容量旧常数已修复，独立rev2覆盖2/2文件、P0/P1/P2=0/GO。目录dev/ino+O_NOFOLLOW稳定FD绑定核验实际通过，UID1000/GID1001、6个inode匹配，根/evidence不可写，live/key挂载0、文件创建0。08:37动态空间预算含1GiB余量需8,771,689,052B，free9,359,241,216B；执行准备时再次CAPACITY_PASS，freeze后仍须重验。五个已审helper已独占安装root0600；service controller已绑定已审backup SHA并进入最后3文件独立复核，未执行。当前079/PID395702、任务1064/attempt1075/run7未变，quiet0。新before-ui-freeze基线SHA为8ed4c77a05389f0aef222f91c84ff4d127149adae533b65a4fca83cfc8a73b00。普通Chrome管理员页已确认总开关开启/紧停关闭/等待完成；未点击任何安全设置或生成按钮。

- 本turn有实际进展；前一个向用户汇报状态的交互不算实施进展。当前HEAD=`1443d69a40db666b5b932f4769e53e46b9ea4173`，PR159已merge=`364f049fceeabec58df85d39bcade82794b94d37`，branch/main CI33953248012/33953350904均success；tag object=`9166295f559db3f8da33d8f9fde4254a7dc5b5e6`精确peel merge，Release已发布，禁止重建/移动。
- 新exact-tag build已安装INACTIVE到`/opt/unboundry/releases/v0.7.10-canvas-read-deadline-20260905`；Node22.23.2/npm10.9.8，903源码零漂移，inventory6129文件SHA=`113a159f33e6b0eb6ec67498028af9a2a653f7647c81a02ebbbdd6a94c9483c5`，安装后全部校验通过，33静态及12内部symlink有效。当前release079/PID395702/NRestarts0未变，未停服或写生产业务库。
- 新维护case=`/var/lib/unboundry-v0710-maintenance-20260905`，0700/UID1000/GID1001。previous42已官方verify/fresh restore，backupId=`0d07c396-7313-476b-9001-d50cafcecd68`，logical=`9dbd83d52726baa9796595185ce7f889090bc20268ffafa579ada625dc443864`，receipt SHA=`a7fd8a025340c71a59b0167834737012b9a1fdb253649ab627c28589cefedc59`；生产data未挂载、网络隔离。625/625最新ready OSS元数据及保留字节匹配，额外GET0/上传0，仍须stop后复验。
- 操作review原P1 stopped-writer legacy门和P2 unknown mode问题已在新`maintenance-preflight.mjs`补齐；同一Reviewer复核2/2文件，P0/P1/P2=0/DESIGN_GO。08:04:30Z active只读样本quiet0、legacy潜在绑定0、业务计数不变；不冒充STOPPED_PRESTART_GATE_PASS。新的latest43-backup-controller与严格逐表主键/行hash comparator已编写、语法检查通过，正在有界独立复核；service切换controller尚未准备完毕，不进入维护窗口。
- 新回执：`spec/V0_7_10_PRODUCTION_RECEIPT_2026-09-05.json`。操作脚本与原始证据在`/tmp/unboundry-v079-runtime-drill.YqH6MK`。本地新增仅操作脚本/文档，不改变已发布产品或测试，不重跑formal full。
- **下一动作**：关闭backup/comparator review，冻结精确维护controller；通过最新freeze/停服/locked-exact43 backup→verify→fresh restore后执行真正service077隔离42回滚→0710 CURRENT43前进及无损比对。完整cold/warm零多余写、唯一目标组、真实音频/三上传/下游/结果刷新和最终生产复核仍全部必须完成。Goal active，不把构建安装当上线或真实验收通过。

以下“进入commit/PR/尚未发布”是此前时点；无需重复已完成步骤。

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
