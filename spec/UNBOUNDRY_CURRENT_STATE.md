# Unboundry 当前权威状态

> **状态分层**：现网为v0.6.46/schema41且服务健康；目标5个旧节点已复用原成功结果收口，零新Generation/Provider/Media/publication/费用。`on → off → on`灰度与止写回退通过，最终mode=`on`；用户已在生产目标Canvas明确回复“通过”，INC-GEN-015为`USER_PASS`。

更新日期：2026-08-26
用途：新会话、压缩恢复、换人接手时先读这份。历史细节仍以各 INC 记录和 receipt 为准，**不得改写历史时点字段**。
当前代码包版本：**v0.6.47**
本地候选代码版本：**v0.6.47**
本地候选schema：**41**
当前治理标记：`CURRENT_V0_6_46_USER_PASS`
当前计划标记：`INC_GEN_015_PRODUCTION_V0_6_46_USER_PASS / TARGET_RECONCILIATION_PASS / ROLLOUT_ON`
当前热修门：`INC_UI_011_HISTORICAL_PRODUCTION_V0_6_43_TECHNICAL_PASS / LOCAL_USER_PASS / USER_RECHECK`
当前本地发布门：`V0_6_47_GOVERNANCE_NODE25_RELEASE_AUTHORIZED / CANDIDATE_FULL_PASS / GITHUB_PENDING`

当前Git身份（2026-08-26本轮基线只读核验）：`main = origin/main = 12e2fd9b54fc8684274fd02c6ebc15625b4c2795`；工作树`/Users/mymy/Documents/unboundry-inc-imgedit-003-v0.6.34-2026-08-23`在本轮治理修改前干净，当前仅有本轮已获同意、尚未提交的治理与工具链修改。旧`/Users/mymy/Documents/unboundry/app`是upstream已失效且含未跟踪文件的历史分支，不能作为当前main施工入口，也不得自动清理。

当前工具链分层：普通项目shell、开发、类型检查和构建默认Node `25.9.0` / npm `11.12.1`；现网v0.6.46仍运行Node `22.23.2` / npm `10.9.8`。安全测试、源码覆盖和不可变release builder暂以Node `22.23.1` / npm `10.9.8`作为生产兼容复现通道；本次只治理本地默认与文档/CI合同，没有迁移、重启或发布生产运行时。验证证据：默认Node25下build与architecture通过；Node22兼容preflight通过，源码覆盖456/456、behavior 1/1、m38+m94 `19/19 PASS`，4173监听身份不变；未运行full。

v0.6.47授权状态：用户已明确“commit push 发布”并确认版本`v0.6.47`，本次commit、push、PR、CI、tag、GitHub Release、SSH与生产发布授权齐备。候选只包含治理文档、默认Node/npm、CI双通道和生产兼容release合同；真实Provider/Generation/OSS预算为0，schema保持41。发布完成前生产仍是v0.6.46，不能提前写v0.6.47已上线。

v0.6.47候选证据：默认Node25.9.0/npm11.12.1下build与architecture通过；生产兼容Node22.23.1/npm10.9.8定向m38+m81+m94共`60/60 PASS`。冻结候选commit `76eaaebaf5271b552a425c3af5885c45a24d606f` / tree `e15fb581…34ef`上的唯一正式safe full为`121/121 specs、1069/1069 tests PASS`，failed/skipped/retries/blocked/reportErrors均0，source/snapshot`8d8f12b8…8f76a`，4173监听身份不变。其后只允许记录证据并运行文档一致性门，不重复业务full；下一门为push/PR/CI/merge/tag/Release。

## 一句话

**生产是 v0.6.46 / schema41且服务健康；5个旧节点已零付费恢复原成功结果，最终灰度为`on`，用户已明确回复“通过”，INC-GEN-015正式收口为USER_PASS。**

## INC-GEN-015 老画布孤立生成态与终态结果自动收口（PRODUCTION_V0_6_46_USER_PASS / TARGET_RECONCILIATION_PASS / ROLLOUT_ON）

- 用户在INC-GEN-014生产复验时发现老问题Canvas仍有节点显示呼吸灯，但实际上没有生成任务在运行。
- 2026-08-26只读证据：目标Canvas有5个持久`Generating=true`节点（3 Text/2 Image、3个runId），对应5个原任务全部success；Canvas和全局active均为0，因此呼吸灯是持久状态残留，不是后台真实生成。
- 已确认代码原因：四类节点在存在`workflowExecutionRunId`时让路单节点恢复；group自动恢复要求浏览器可信checkpoint/acceptedTasks；当旧run绑定仍在而checkpoint缺失/不可用时，两条恢复路径都可能不接管。
- 诚实审计结论：无法证明归属时fail-closed合理，无限显示生成中不合理；当前为P1状态真实性/历史兼容bug，未发现重复付费、Provider重提、结果删除或活动任务。
- 最终方案要求：全部checkpoint按精确runId优先；只GET原taskId；活动任务保留呼吸灯；完整success复用既有projection；明确终态但语义冲突/结果不完整走服务端原子`terminal-detach`；unknown显示中性blocked且零写、零新提交。
- 审计6项阻塞已全部进入合同：原子字段集合、窄职责terminal-detach、全checkpoint精确匹配、unknown保护、server-controlled detect/allowlist/on/off灰度、revision安全的字段级回退。
- LGR-01～12、R0～R6、风险驱动m22/m85/m41验证、独立终审、唯一safe full和生产灰度/回退门已冻结；schema首选保持41。
- 权威方案：`spec/INC_GEN_015_LEGACY_CANVAS_ORPHAN_GENERATION_STATE_RECONCILIATION_PLAN_2026-08-26.md`。
- v0.6.45候选已完成完整候选判定、全部checkpoint精确优先、原task只读核对、活动态显示、既有安全投影、终态原子detach、unknown阻断、无锁零写与全局零新单保护；服务端灰度为`off/detect/allowlist/on`，schema保持41。
- 首轮独立只读终审为`NO-GO / P0=0 / P1=4`：缺少active/unknown有界重读、旧状态可能跨新生成残留、task归属证明不足、OpenAPI required/properties矛盾；该轮未冒充PASS。
- 4项P1均已关闭，并额外修复无result的success分类异常。修复后同一source/snapshot`e4962ca3…9ca8`下m41 `52/52`、m22 `40/40`、m5 `21/21`、m20 `1/1 PASS`；此前m85 `27/27`、m81 `41/41`仍有效，TypeScript通过，4173不变。
- 同一审查线程第二轮复核为`NO-GO / P0=0 / P1=2`，指出classifier unknown/无锁/write-disabled未全部有界重读、scope cleanup未abort且policy GET无deadline。现已按1/2/4秒有限重读所有UNKNOWN/不可写分支，cleanup真实abort，policy GET具备10秒deadline。
- 第二轮修复后同一source/snapshot`8b1e93e1…3896`下m41 `53/53`、m22 `41/41 PASS`，新增无锁有界停止、零写和policy deadline/cleanup abort证据。真实Generation POST、Provider submit/probe、Media/OSS写和费用仍为0；当前没有commit、GitHub或生产变化，目标Canvas尚未写入；唯一下一步是同一独立审查线程最终复核。
- 同一审查线程第三轮复核为`NO-GO / P0=0 / P1=2`，指出malformed rollout policy缺少运行时拒绝、Canvas admission内deferred分支未安排重读。现已用共享解析器严格校验mode/writeEnabled组合并fail-closed，且匹配lease到期后按同一scope重读原task；签名变化不再清空其他scope预算。
- 第三轮修复后同一source/snapshot`5f28ce23…11c1`下m41 `54/54`、m22 `41/41 PASS`，新增deferred恢复、malformed policy fail-closed和零Generation证据。真实Generation POST、Provider submit/probe、Media/OSS写和费用仍为0；当前没有commit、GitHub或生产变化，目标Canvas尚未写入；唯一下一步仍是同一独立审查线程最终复核。
- 同一审查线程第四轮复核为`NO-GO / P0=2 / P1=2`：额外policy字段可穿透、其他活动run lease未阻断旧detach、旧projection快照可覆盖并发用户编辑、terminal-detach未把success proof精确绑定权威resultKey。现已严格policy键集合；在锁外与admission内检查同节点其他活动run；projection事务要求精确observed revision并从新GET安全重试；服务端派生权威resultKey并与请求/节点proof三方匹配。
- 第四轮修复产品源码快照`172e053d…af1f`下m41 `54/54`、m22 `41/41`、m20 `1/1 PASS`；仅增强m85测试后的当前快照`15a5564e…57b3`下m85 `27/27 PASS`。TypeScript/diff门通过，真实Generation POST、Provider submit/probe、Media/OSS写和费用仍为0；当前没有commit、GitHub或生产变化，目标Canvas尚未写入；唯一下一步仍是同一独立审查线程最终复核。
- 同一独立线程第五轮逐项确认第四轮4项阻断全部`CLOSED`，最终结论`P0=0 / P1=0 / GO`；未发现新的重复付费、unknown解锁、无Web Locks写、活动任务误清、结果覆盖或跨owner/API语义缺口。审查全程零写、零测试、零网络。
- 冻结候选commit`f243e8eab0d534f9c7c0518b3898f6cd67857057`/tree`2c8ae98bb1869e7454e5b96849ee9116e4ee04f0`的本Goal唯一safe full已通过：`121/121 specs、1069/1069 tests PASS`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot`df8cdec086998654d8635cedb433737b100fed7389ca1073cbc2d059999a3d68`，4173监听不变。不得重复full；当前唯一下一步是GitHub发布。
- PR #105、PR/main Quality CI、merge`72e1b60`、tag/Release `v0.6.45`已完成；fresh tag构建、366文件冻结备份/恢复、原子切换、公网/回环健康、schema41、service active+enabled/NRestarts0均通过。
- detect模式与技术Canvas allowlist实页均为零写；tasks814/attempts822/active0/media849/publications439/canvases67/dataFiles366不变，真实Generation/Provider/Media/OSS/费用0。
- 用户确认登录提交后，可控Chrome与内置浏览器均以目标owner`zzx`打开目标Canvas；5个候选最终均为静态`UNKNOWN_BLOCKED / 状态待核对`。Chrome与服务端日志确认每节点3次有界projection，共15个Canvas PUT均返回`400 CANVAS_DOCUMENT_INVALID`。
- 根因为v0.6.45把原始`generationInputKey`误当ASCII短ID：真实指纹为1644字符JSON并含中文；projection限制512且terminal-detach仍为ASCII/2048/16KiB。所有失败都在校验阶段关闭，5个binding与原任务未变；目标Generation POST、Provider、retry、Media/OSS、publication和费用0。其他owner的全局并发变化不归因于本Goal。
- 本地补丁commit`ff3d139f1aceba1fd02b406bdd0fa5290175ea0e`统一两条路径为opaque非空最多100000字符，其他身份/CAS不放宽，detach body有1MiB硬上限。TypeScript、safe m20 `1/1`、m85 `27/27 PASS`，source/snapshot`3828c8e3…f1c6`，4173不变；没有重复唯一full。
- 新独立终审首轮`NO-GO / P0=0 / P1=1`发现detach同类缺口；修复后复审`P0=0 / P1=0 / GO`。v0.6.45继续不可移动且不直接覆盖生产。
- 文档治理m38首轮`14/15`只因生产句式未命中既有正则；修正后`15/15 PASS`，source/snapshot`92b712e5…991e`、4173不变，未重复业务spec或full。
- 用户已明确授权以v0.6.46继续发布；package/lock/final runtime role同步完成，TypeScript与safe m81 `41/41 PASS`，source/snapshot`c5ba0228…0aec`、4173不变；版本文档m38修正唯一候选标记后`15/15 PASS`，source/snapshot`a0251547…9dc`、4173不变。当前进入GitHub与不可变生产发布流程，不重复唯一full。
- v0.6.46候选commit`78b5f8a`/tree`80378c4`经PR #107、PR/main Quality CI、merge`c961cee`进入main；annotated tag对象`0ce3278…3e45`与GitHub Release已发布，tag peeled commit与main树精确一致。
- fresh tag archive在生产固定Node22.23.2/npm10.9.8构建为5978文件、inventory`50c8bd13…88c2`；首次构建只因PATH继承Node18在切换前失败，固定Node22后重跑失败构建，未影响现网。
- 60秒静默门tasks825/attempts833/active0稳定；冻结source/restore各366文件，manifest`a15b3626…e7cf`一致，schema41/integrity ok/FK0；带自动回退trap的原子切换通过。
- zzx目标allowlist复验使5个旧候选全部复用原success task/result proof；Generating=false且task/ownership/input/run旧binding清空，页面`状态待核对=0 / 生成中=0`。
- 目标Canvas revision336/graph52→343/58；39节点/73边、节点ID、连线、viewport、位置和父子关系不变，只有5个候选结果/收口字段变化。target tasks10/attempts10与原5个success task不变。
- global tasks825/attempts833/active0/media855/publications445/canvases68不变；Generation POST、Provider submit/retry、Media/OSS、publication和新增费用均0。
- 服务端首次`on`、`off`止写回退、最终`on`均通过；各阶段重载目标Canvas均revision343/graph58不变、Canvas PUT0、Generation/Provider/Media/publication POST0。最终生产mode=`on`。
- 最终生产回执与治理文档同步后的safe m38 `15/15 PASS`，source/snapshot`750654cb…ce28`、4173不变；未重复业务spec或本Goal唯一full。
- 用户在生产目标Canvas目视复验后明确回复“通过”；本确认只关闭INC-GEN-015的5个恢复结果，不改写其他独立`USER_RECHECK`条目，也不构成新代码、Provider或发布授权。
- USER_PASS治理同步仅运行safe m38，`15/15 PASS`且异常0；source/snapshot`f5c542e1…33b8`、4173不变，未重复业务spec或唯一full。
- 权威生产回执：`spec/V0_6_46_PRODUCTION_RECEIPT_2026-08-26.json`。当前为`PRODUCTION_V0_6_46_USER_PASS / TARGET_RECONCILIATION_PASS / ROLLOUT_ON`，本项已完成且无活动下一动作。

## INC-GEN-014 工作流自动恢复与密钥校验解耦（R0～R5_COMPLETE / R6_TARGETED_PASS）

- 用户报告涉事账号整组生成再次因“画布保存状态异常”出现后续节点未运行，同时「我的连接」的API Key校验被运行任务保护阻止。
- 当前代码已核实两个独立根因：整组执行仍把Canvas投影失败降级为节点执行失败；`verifyAccountCredential`写回状态时误用密钥替换/删除的paid-work guard。
- 最终方案已冻结：Generation Task/Attempt/Media/ownership proof作为执行事实，Canvas只作结果投影；使用applicationId幂等、generation-owned字段三方合并和有界自动对账。当前存活run可继续，刷新恢复只GET原任务且新的付费pending POST为0。
- 密钥校验始终允许，使用credential/profile快照和CAS写回；替换/删除继续受运行任务保护；瞬态失败不得伪装成invalid。
- 权威方案：`spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_PLAN_2026-08-25.md`。
- 文档一致性定向m38首轮`14/15`，修正计划状态与既有生产治理标记混写后`15/15 PASS`；没有运行业务spec或full。
- 新Goal只读身份核验通过：HEAD/origin/main均为`42bc0ac…fe9295`，生产仍为`v0.6.43/schema41`；`v0.6.44`tag/Release未占用，版本及本Goal发布授权已确认。
- 实时断点：`spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_CHECKPOINT.md`；当前真实Provider、Generation、OSS和费用仍为0。
- R1安全预期红精确完成：m22 `35/37`仅两项冻结失败，证明投影失败仍会降级节点并阻断下游；m73 `14/16`仅两项冻结失败，证明运行任务错误拒绝verify且瞬态错误丢失结构化code。4173监听者不变。
- R2～R5实现完成：节点结果proof成立即execution success；Canvas写回使用最新owner-scoped文档、generation-owned白名单、applicationId、语义/ownership/input围栏、Web Lock单writer、4次退避与单次超时/abort。冲突时不覆盖、不重提，原结果留在任务历史。
- verify只做只读远端probe与状态CAS，不再调用paid-work mutation guard；保存/替换/删除保护未放宽。credential revision或profile configuration变化返回CHANGED；只有AUTH写invalid，PERMISSION/网络/限流/5xx/格式为unknown；API返回稳定code。
- 当前候选安全定向m22 `37/37`、m73 `16/16`、m20 `1/1`，TypeScript/生产构建与源码门通过；source/snapshot`ca81902e…a21b`、4173不变，真实Provider/Generation/OSS/费用仍为0。
- package/lock与final runtime role已同步为v0.6.44，schema保持41；safe m81 `41/41 PASS`，source/snapshot`66a14287…0158f`、4173不变。
- 首轮独立只读终审发现`2 P0 + 2 P1`，现已全部关闭：投影写入新增服务端事务内目标语义CAS；terminal success不再回退失效旧plan；无Web Locks浏览器零投影写fail-closed；accepted-task人工继续统一经过persist/projection边界。
- 修复后最小受影响safe为m22 `37/37`、m85 `26/26`、m20 `1/1 PASS`；只用动态loopback、临时数据与fake边界，4173和真实Provider/Generation/OSS/费用均不变。当前等待同一独立审查线程复核，不冒充最终P0/P1=0或safe full。
- 第二轮独立复核确认首轮4项关闭，另发现`1 P1`：projection exhausted后人工继续可能因success proof跳过节点并误清checkpoint。现已用持久`projectionPendingNodeIds`和逐节点settled receipt关闭；人工/自动继续只GET accepted原task并重建projection，m22最小复验`37/37 PASS`。当前仍等待最终独立复核。
- 第三轮复核另发现`1 P1`活性缺口：pending recover后direct Canvas persist成功未形成receipt。普通DAG与accepted-only现均把`projectionState=applied`转换成逐节点receipt并与queue receipt统一结算，m22 `37/37 PASS`、generation POST 0；仍等待最终独立复核。
- 同一独立只读终审线程最终复核为`P0=0 / P1=0 / GO`，未发现新增重复付费、结果覆盖、credential隔离或API语义问题；审查全程零写、零测试、零网络。
- 文档治理m38首轮产品`14/15`只因生产句式未匹配既有正则，修正文案后最小复验`15/15 PASS`；source/snapshot`6428b45b…6414`，未重复业务spec。
- account/canvas/application三重scope和投影队列异常收口后，最小复验m22 `37/37 PASS`；功能候选source/snapshot`2c889063…3042`，4173不变。
- 首轮正式full只发现m20 OpenAPI枚举快照未包含新投影冲突码，产品其余`1060/1061`全部通过；补齐该契约后定向m20 `1/1 PASS`。修正后clean-record safe full在commit`626d209`/tree`f55860b`完成`121/121 specs、1061/1061 tests PASS`，failed/skipped/retries/blocked/reportErrors均0，source/snapshot`c5f8dc61…bd07`、4173 unchanged。真实Provider/Generation/OSS/probe/费用仍为0。
- PR #103、PR/main Quality CI、merge`3ff3df4`、不可移动tag/GitHub Release v0.6.44均通过。生产以tag源码fresh build，冻结source/restore各366文件并完成schema41/integrity ok/FK0恢复演练后原子切换；公网/回环v0.6.44、live/ready active、service active+enabled/NRestarts0、inventory与静态资源全部通过。
- 切换前后tasks814、attempts822、active0、media849、publications439、canvases67、dataFiles366不变；probe、真实生成、Generation POST、OSS写和费用均0，未修改账号业务画布。回执：`spec/V0_6_44_PRODUCTION_RECEIPT_2026-08-26.json`。当前严格为`PRODUCTION_V0_6_44_TECHNICAL_PASS / USER_RECHECK`，不是USER_PASS。
- 生产回执落档后只运行治理定向m38；两轮`14/15`依次暴露AGENTS与渐进治理文档的旧生产标记，统一为`CURRENT_V0_6_44_USER_RECHECK`后`15/15 PASS`，source/snapshot`18914338…321a6`、4173不变；未重复业务spec或full。

## INC-UI-011 节点排序菜单层级修复（PRODUCTION_V0_6_43_TECHNICAL_PASS / USER_RECHECK）

- 用户截图显示组合框「节点排序」菜单向下展开后被组内节点遮挡；代码核实为组合框`zIndex: 0`、子节点`zIndex: 1`形成的父级层叠上下文问题，单独提高菜单`z-index`不能脱离父级。
- 已完成最小修复：只将「宫格 / 水平」菜单Portal到`document.body`并使用触发按钮屏幕矩形定位，补齐上下翻转、左右8px收边、`nodrag nopan nowheel`、ARIA、Escape返焦、外部/失选/画布切换/滚轮关闭；没有提高组合框或降低子节点层级，也没有修改排序算法。
- 密集fixture旧实现预期红为m2 `4/5`，唯一失败是按钮中心非最上层；最终safe m2 `5/5 PASS`，source/snapshot`d729b635…d6d4f`，TypeScript 408/408与生产构建通过，4173不变。
- `1280×720`、`1440×900`、`1920×1080`三视口的遮挡、翻转、左右收边、Escape、应用console/pageerror和零手势通过；打开/关闭图快照不变、画布`PUT=0`。
- 用户于2026-08-25在可见本地密集组合框测试页亲自复验，并明确回复「通过 继续」；因此本地验收已收口为`USER_PASS`，但不自动等于生产`USER_PASS`。
- `USER_PASS`权威文档同步后的定向safe m38为`15/15 PASS`，failed/skipped/retries/blocked/reportErrors均0，4173监听者不变。
- Provider、Generation、OSS写入、购买/订阅和费用均0；package与生产均为0.6.43、schema保持41。PR #100、PR/main Quality CI、merge`0f7a41d`、不可移动tag/GitHub Release已完成；一次性发布授权已消费。权威方案：`spec/INC_UI_011_GROUP_LAYOUT_MENU_LAYERING_PLAN_2026-08-25.md`。
- v0.6.43运行时版本同步后的定向safe m81为`41/41 PASS`；唯一safe full在精确commit`92e8325`/tree`89cf2be`完成`121/121 specs、1061/1061 tests PASS`，failed/skipped/retries/blocked/reportErrors均0，TypeScript 408/408、Vite构建、source/snapshot一致、immutable release builder和4173不变门均通过。后续证据文档只做m38定向复验，不重复full。
- 生产release`/opt/unboundry/releases/v0.6.43-inc-ui-011-menu-layering-20260825`共5973文件，inventory`d9e0886…d0291`；权威冻结source/restore各366文件、双清单`31dd802…caa`，schema41恢复副本integrity ok/FK0。原子切换后公网/回环v0.6.43、service active+enabled/NRestarts0、数据与8项静态资源门通过。
- 生产零付费浏览器在技术项目中选中密集组合框后，「宫格/水平」可见，宫格中心`elementFromPoint()`命中自身，菜单z-index 1000，Escape关闭并返焦；canvas revision 233、graph revision 92、updated_at在前后完全不变。当前严格为`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`；回执`spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json`。

## INC-GEN-013 整组刷新恢复与组合框拖动性能治理（PRODUCTION_V0_6_42_TECHNICAL_PASS / USER_RECHECK）

- 权威方案：`spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_PLAN_2026-08-25.md`
- 实时断点：`spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_CHECKPOINT.md`
- 只读证据显示涉事服务端任务和Provider已成功、结果媒体仍在OSS；截图提示是防止重复付费的安全门，不是服务端生成失败。
- 自动恢复缺口来自group run checkpoint没有可靠保存已接收任务的完整绑定；后续方案只允许`accepted-tasks-only`查询和回填原任务，generation POST必须为0，pending节点不得自动提交。
- 拖动卡顿直接落在`GroupNode.tsx`旧自定义拖动旁路：每次pointer move直接`setNodes`并绕过统一交互/持久化门。它不是后续Git提交撤销修复，而是历史旁路和测试覆盖缺口形成的实际体验回归。
- 方案已冻结向后兼容checkpoint、精确写回围栏、单写入租约、先保存确认再清理，以及组合框优先原生拖动/必要时共享交互端口的止损路径。
- 本地实现已完成；schema/OpenAPI不变。定向m1`6/6`、m2`5/5`、m3`6/6`、m40`14/14`、m79`3/3`、m22最终`37/37`，build/diff-check通过。
- rich fixture精确为3组/39节点/73边、zoom15.6%；p95`9.9ms`、max`10.3ms`、long task和dropped frame均0、媒体请求0、最终画布PUT1。
- 独立终审原始2个P1已关闭：accepted但未绑定的精确任务可进入恢复，外来租约立即abort旧poller；当前无已知P0/P1。
- 本Goal唯一safe full在功能候选`31f0fcbc…ee4b`原始`1060/1061`；唯一未改动m0筛选计数瞬态失败在相同源码快照定向`23/23 PASS`，未重复full；source/snapshot `3baf4f5d…97e41`、4173 unchanged。
- PR #98、PR/main Quality CI、merge`2203889`、tag/GitHub Release完成；tag/main tree同为`c6035375…e80a`。
- 生产release`/opt/unboundry/releases/v0.6.42-group-recovery-drag-performance-20260825`共5971文件，inventory`a48a4ce…9666e`；冻结source/restore各366文件，双清单`19c40c3…d3e28`，standalone rehearsal schema41/integrity ok/FK0。
- 公网/回环v0.6.42、service active+enabled/NRestarts0、数据和全部构建JS/CSS一致；三视口复杂组拖动、停止、撤销、刷新保持通过，最终位置精确还原，应用console error/warn0。
- 新验收`GEN-011～012 / CANVAS-020～022`为`PRODUCTION_AUTO_PASS / USER_RECHECK`；tasks/attempts/media/publications无增量，真实Provider/Generation/OSS写入/费用均0。回执`spec/V0_6_42_PRODUCTION_RECEIPT_2026-08-25.json`。

## INC-SEEDANCE-002 AI角色单图合规验证（BRANCH_C / PRODUCTION_V0_6_41_TECHNICAL_PASS / USER_RECHECK）

- 权威方案：`spec/INC_SEEDANCE_002_AI_CHARACTER_SINGLE_IMAGE_COMPLIANCE_PLAN_2026-08-25.md`；实时断点：`spec/INC_SEEDANCE_002_AI_CHARACTER_SINGLE_IMAGE_COMPLIANCE_CHECKPOINT.md`。
- 正式一手合同只支持Seedance真人私域素材链；第三方审核票据没有正式提交字段，虚拟人像权益额外订阅超预算。Sightengine/Hive公开合同不足以完整证明人物、公众人物、版权IP、未成年人/敏感和隐私边界，因此B、A依次不成立，自动选择C。
- C分支产品名固定「角色风险预检」：菜单入口直接禁用并标注当前不可用，保留独立的「角色可信素材」入口，不显示蓝勾，不使用「Seedance已验证」「版权已认证」「法律合规」文案；用户附件未发送到任何Provider。
- schema41新增独立Check/Attempt/Disclosure三表；Port/Application/Store、fake Provider、16态、风险码、API/OpenAPI、ImageToolHost关闭态、刷新读模型和未来可插拔Provider边界已完成。INC-SEEDANCE-001三表、信任状态和历史H5请求未迁移、未重提。
- Generation已在task-create和provider-submit双重支持正式B快照核验；A风险预检在付费前拒绝，Ark adapter在没有官方翻译合同时拒绝第三方ticket。当前C不会生成ticket、任务或Provider请求。
- schema41已贯穿备份/恢复/媒体/版本/bridge/release；新增精确schema40→41 dry-run/apply迁移。最终定向：m101 `4/4`、m2 `13/13`、m20 `1/1`、m5 `21/21`、m10 `17/17`、m91 `9/9`、m92 `2/2`、m95 `5/5 PASS`。
- 独立终审原始`1 P0 + 5 P1`已全部关闭：Generation/Provider/策略身份全绑定，旧真人入口保留，Attempt未知结果不自动重提，审计不随媒体删除，C入口菜单层禁用；无剩余P0/P1。
- 冻结功能commit `9f4ed1589bb4d8d65619186035a076f572409255`的本Goal唯一safe full为`121/121 specs、1061/1061 tests PASS`，异常0，source/snapshot `07a69e52…a60c2863`，4173 unchanged；后续文档收口不重复full。
- PR #96、main Quality run `32776214629`、merge `59599df`、tag/GitHub Release `v0.6.41`均完成；tag与main tree同为`2e7f1cd6…b6`。
- 生产release `/opt/unboundry/releases/v0.6.41-seedance-character-compliance-20260825`共5968文件，inventory `7a2f12dd…e884b3`；冻结备份source/restore各366文件，双清单`5a5b2f9e…adb5a`；schema40→41副本演练与生产迁移、原子切换、公网/回环/service/schema41/数据/inventory/5资源门全部通过。
- 生产浏览器三视口均显示disabled「角色风险预检（当前不可用）」及enabled「角色可信素材」，刷新恢复一致，console 0；tasks/attempts/合规行增量0。
- 请求账本：Provider控制面0、真实审核创建0、状态查询0、Generation0、OSS0、订阅/购买0、费用0。当前为`USER_RECHECK`，不能提前写`USER_PASS`；回执`spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json`。

## INC-SEEDANCE-001 Seedance可信素材真实链路恢复（PRODUCTION_V0_6_40_TECHNICAL_PASS / BLOCKED_EXTERNAL_CAPABILITY）

- 权威方案：`spec/INC_SEEDANCE_001_TRUSTED_ASSET_REAL_CHAIN_RECOVERY_PLAN_2026-08-24.md`；实时断点：`spec/INC_SEEDANCE_001_TRUSTED_ASSET_REAL_CHAIN_RECOVERY_CHECKPOINT.md`。
- 正式合同确认管控面 Base URL 与四个私域素材 Action 使用`ark.cn-beijing.volcengineapi.com`；H5创建另要求必填公网HTTPS `CallbackURL`。
- v0.6.38实现同时存在控制面主机错误和CallbackURL缺失；v0.6.39已统一URL/Host/V4签名主机并配置`UNBOUNDRY_SEEDANCE_ARK_CALLBACK_URL=https://canvas.mymy.ltd/`，缺失或非法时请求前fail-closed。
- m42最终`16/16`、m81 `41/41`、m38 `15/15 PASS`。唯一safe full原始`1055/1056`，唯一为m1性能抖动，同源码m1复验`1/1 PASS`，未重复full。
- tag源码commit`8bc89c0`/tree`4c504919`；PR #90合并`1540d6b`且tree相同，Quality CI成功，GitHub Release已发布。生产release`/opt/unboundry/releases/v0.6.39-seedance-trusted-chain-20260824`，冻结备份`/var/lib/unboundry-rollbacks/v0.6.39-cutover-frozen-OFeGIs` source/restore各366文件且双清单SHA`fcb8791d…8e20`；公网/回环/service/schema40/数据/inventory通过。
- 新事件唯一`CreateVisualValidateSession`于`2026-08-24T13:54:10Z`返回本地HTTP503，session保存`FAILED/CREATE_FAILED`，没有Provider session ID、H5Link或BytedToken。现有脱敏层丢弃远端HTTP状态、错误码与RequestId，只能确认远端边界快速失败，不能把原因写成ArkFullAccess、参数、签名或格式中的任一项。
- 官方私域人像指南明确AK需具备对应Project的`ArkFullAccess`；这是下一轮必须人工核对的前提，不是本次已证实根因。账本：H5创建`1/1`，认证查询`0/15`，Asset创建`0/1`，Asset查询`0/33`，总计`1/50`；Generation task/attempt、费用、OSS测试写入均0。
- v0.6.40候选在既有固定安全错误响应之外，受限保留并持久化Provider HTTP状态、错误码和RequestId；远端Message、Body、AK/SK不进入应用错误或数据库。最终定向m42+m100+m81+m9为4 specs、`71/71 PASS`；唯一safe full原始`1055/1056`，唯一失败为AGENTS治理短语多一个“仍”字，产品1055项均通过，修正后m38 `15/15 PASS`，未重复full。full source/snapshot `ce05428c…c64`；m38 source/snapshot `c62658c6…8c70`；真实Provider、Generation、OSS和费用0。
- commit`70e3730`、PR #92、Quality CI run`32744976578`、merge`21eb483`、tag与GitHub Release `v0.6.40`均已完成；tag与main tree同为`1defaa5`。
- fresh release`/opt/unboundry/releases/v0.6.40-seedance-provider-diagnostics-20260824`共5952文件，inventory SHA`1f440381…a4084`；冻结备份`/var/lib/unboundry-rollbacks/v0.6.40-cutover-frozen-OtzczQ`的source/restore各366文件且双清单SHA`f88135d5…b51a`。
- 生产已原子切换到v0.6.40；公网/回环version、live、ready active/schema40、service active+enabled/NRestarts0、数据库quick_check/FK、切换前后数据与媒体、5项公网资源均通过，新增service warning与NGINX error均0。回执：`spec/V0_6_40_PRODUCTION_RECEIPT_2026-08-24.json`。
- 用户动作时确认后，Project `default`只为IAM用户`tapnow-ark-catalog-ro-20260803`新增系统策略`ArkFullAccess`，结果1成功、0失败；用户详情明确显示`default(默认项目)`限制，原`TapNowArkCatalogReadOnly`保留。一次误从用户入口加入的无Project限制策略被立即撤销并核验无残留，随后才从正确Project入口提交。
- 生产对新已就绪图片只执行一次`CreateVisualValidateSession`；本地HTTP503对应远端`HTTP 403 / SubscriptionRequired`，RequestId `202608250008127B4DD9D53F9A85BDEFF9`。session为`FAILED`，无Provider session ID、H5Link或BytedToken。
- 新账本为H5创建`1/1`、认证查询`0/15`、Asset创建`0/1`、Asset查询`0/33`，总计`1/50`；Generation、费用、OSS测试写入均0。明确的订阅缺失证明Project权限不是根因；本事件不购买、不重试、不进入Asset阶段。
- 当前`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_APPLIED / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / BLOCKED_EXTERNAL_CAPABILITY / USER_RECHECK`。现网仍按配置展示A分支入口，但真实有效能力应按C分支处理；修正能力探测或入口需要新的版本和授权，v0.6.40 tag/release不移动。

## INC-IMGEDIT-006 图片全屏完整适配与Seedance可信素材（PRODUCTION_V0_6_38 / USER_PASS）

- 权威方案为`spec/INC_IMGEDIT_006_FULLSCREEN_FIT_AND_SEEDANCE_TRUSTED_ASSET_PLAN_2026-08-24.md`，实时断点为`spec/INC_IMGEDIT_006_FULLSCREEN_FIT_AND_SEEDANCE_TRUSTED_ASSET_CHECKPOINT.md`，生产回执为`spec/V0_6_38_PRODUCTION_RECEIPT_2026-08-24.json`；v0.6.38发布授权已执行并消费。
- R2已修复1086×1448、3:4、9:16、16:9、1:1和超宽图在三视口的双轴完整适配；R3移除会冒充远端可信素材的旧本地校验入口。
- R4～R6新增schema40的owner/profile/account/region/project/source绑定、正式方舟A分支控制adapter、只由服务端构造的`asset://`判别联合、任务快照及提交/Provider边界双重复核；伪造、跨账号、失效和旧快照全部fail-closed。
- R7新增“角色可信素材”modal、同步预开H5、双击防重、20秒QPM兼容轮询、session ID刷新恢复、Processing到Active服务端推进、A/B/C与失败状态准确文案、inert/Escape/焦点及三视口。最终build和safe m100+m2+m20 `27/27 PASS`，source/snapshot`f22637b7…d2d0d1`，自动化真实Provider/Generation/OSS/费用0。
- R8只读审查补齐Active绑定主动远端复核与schema40发布链：备份/恢复/媒体完整性、exact-v0.5.1、one-shot迁移、40迁移失败回滚、Linux验证及bridge rollback均已同步。诊断批次原始`35/56`、`45/48`，修正后精确`19/19`、`90/90`、`8/8 PASS`，P0/P1无剩余。
- 本Goal唯一safe full在`d5c5840`执行120 specs/1055 tests，原始`1053/1055`、退出1；m10漏收schema40迁移错误码、m9旧正则误判Authorization产品语义。精确修正后只复验m10+m9 `18/18 PASS`，source/snapshot`ad6bc903…60dd3`，未重复full；R8按原始结果收口。
- 治理提交`34893db`后的m38精确复验`15/15 PASS`、source/snapshot`7c05244d…9e8aa`；文档同步不重复业务测试。
- R9 tag`v0.6.38`→`ff8b80c`/tree`c8e1e19`，PR #87 Quality CI SUCCESS并合并为`1a1756a`，GitHub Release已发布。
- R10/R11已完成双备份、schema39→40副本演练、旧runtime拒绝不改写、fresh build、原子切换、公网/回环/service/inventory/数据/5资源与三视口浏览器门；冻结备份`v0.6.38-cutover-frozen-hoN2aM`双清单`5ebe6ef5…b7a7`。
- 生产全屏代表图444×818在1280×720、1440×900、1728×900均四边完整、比例不变且contain；755×1332第二竖图同样通过，console error/warn0。
- Provider控制面账本为`2/200`：权益只读1、唯一H5创建1，其余0。H5创建返回HTTP503并保存为`FAILED/CREATE_FAILED`，没有H5 URL；因创建预算耗尽且副作用未知未重试，未进入Asset阶段。付费生成、Generation task/attempt增量、费用和OSS写入0。
- 用户于2026-08-24在生产实页明确回复“通过”，当前状态`PRODUCTION_PUBLISHED_USER_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / USER_PASS`。该确认覆盖全屏完整显示与Seedance失败态的真实呈现，不把真实协议失败改写为`PROVIDER_PROTOCOL_REAL_PASS`。

## INC-IMGEDIT-005 图片工具产品质量拒收返工（R9_COMPLETE / USER_RECHECK）

- 用户在前一轮本地纠正后继续指出：图片全屏缺少提示词、模型、尺寸等详情；派生结果使用固定坐标覆盖；Seedance素材校验只有本地规则；擦除、扩图、增强等本地与模型处理方式不透明
- 只读检查确认图片详情确实只有标题/下载/关闭，视频详情已有完整信息；多个派生use case仍使用`source.x + source.width + 140`；Seedance返回`remoteValidationAvailable:false / local-technical-preflight`；擦除/重绘/扩图为本地mask或准备图加模型生成，保守增强为本地轻滤镜
- 权威方案为`spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_PLAN_2026-08-24.md`，实时断点为`spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_CHECKPOINT.md`
- 方案覆盖图片详情、统一空白区放置、有效内容切分、透明Surface、扩图参数真实性、预计金额移除、处理引擎语义、Seedance三层校验及顶部9项/更多8项全review；验收新增`IMGEDIT-029～038`
- R0～R8本地工程完成；三轮独立审查关闭全部P1/P2，最终`INDEPENDENT_REVIEW_PASS`。最终safe m100+m2 `24/24 PASS`，source/snapshot`015a7329…95c8`。唯一一次safe full原始120 specs / 1053 tests为`1052/1053 PASS`，唯一失败是旧m38治理正则不能表达用户拒收与未定候选版本；精确修正后只复验m38并`15/15 PASS`，未运行第二次full
- 用户已明确给出`版本号确认：v0.6.37`与`允许发布：v0.6.37 上线`；该一次性授权已完成并消费
- tag `v0.6.37`解引用到`d28996b`/tree`c710145c`；PR #85合并为`0d65c98`且main tree相同，Quality gates SUCCESS，GitHub Release已发布
- 生产已原子切换到`/opt/unboundry/releases/v0.6.37-inc-imgedit-005-20260824`；冻结备份`/var/lib/unboundry-rollbacks/v0.6.37-frozen-taKYwu`双清单一致；schema39、主库/Library、数据计数、service、公网/回环、inventory和5资源全部通过
- 生产零付费浏览器复验完成三视口代表矩阵、全屏详情、有效内容切分、扩图语义、Seedance三层、单一Host/inert、无预计金额和零写网络门；console error/warn0，数据不变
- 真实Provider/尝试/成功/费用和真实OSS测试写入继续固定为0；旧6次/60 USD与v0.6.37发布授权不得复用。回执：`spec/V0_6_37_PRODUCTION_RECEIPT_2026-08-24.json`

v0.6.34冻结前定向`234/234 PASS`；唯一一次safe full原始`1048/1052`，只修正一个真实图片预检缺陷与三个测试确定性问题后，精确四spec `106/106 PASS`，没有第二次full。GitHub、冻结备份与恢复副本、精确tag源码构建、schema39数据门、原子切换、公网/回环/service/inventory/资源门均已完成。

发布流程自身Provider请求和OSS写入均为0。用户另行确认D13真实Provider技术冒烟最多6次、总预算上限60 USD，并确认剩余5项总额不超过50 USD；v0.6.35六项各一次真实提交成功、无重试，生产tasks/attempts为`728/736`、active0，最终`6/6 / 60 USD`。主体抠图结果另以OSS原始字节确认真实Alpha。

v0.6.34版本号、tag和发布授权均已执行并消费，禁止移动tag或覆盖release。用户于2026-08-24明确确认`v0.6.35`并独立回复“按v0.6.35上线吧”；新授权只覆盖共同生成热修及Goal内剩余D13，不扩大到Mureka、团队/多人协作、真实Agent协议、Storyboard完整编辑、图片打光或其他既有`PARTIAL/PAUSED/BLOCK`项。

## INC-IMGEDIT-004 图片工具交互与 UI 一次性返工（PRODUCTION_V0_6_36_USER_REJECTED / LOCAL_REMEDIATION_NOT_RELEASED）

- 2026-08-24用户抽查后明确拒收：快速切分把透明留白算入比例；大型编辑层整面铺黑灰棋盘格；扩图参数与提示词不透明；UI规范偏离；多个位置展示无用的预计USD；并要求复审顶部工具栏与“更多”内全部功能。
- 本地纠正已完成：快速切分先按Alpha扫描可见主体边界再分片；普通节点/工具舞台恢复纯灰壳层，棋盘格只保留给真实透明输出；移除全部图片工具用户可见预计USD/CNY；扩图明确展示输入到输出尺寸，并确认范围通过准备图、蒙版和持久参数提交，提示词仅为可见输入框内容；修复“更多”底部Seedance被Creator遮挡、蓝色原生焦点/滑块偏色等额外审查发现。
- 已逐一浏览器复审顶部9项（裁剪、多角度、重绘、打光暂停态、更多、颜色、素材库、下载、全屏）和更多菜单8项（扩图、擦除、标注、增强、调整像素、抠图、快速切分、Seedance），覆盖1280×720、1440×900、1728×900代表矩阵；生成式按钮全部禁用，Generation/Provider/OSS/费用0。
- 当前代码树safe m2 `11/11 PASS`，m100同一业务合同改动树`13/13 PASS`；未重复既有full。该证据只证明本地纠正，不代表生产已修复或用户通过。

- 用户在生产实页反馈图片工具“几乎都不正常”且没有对齐项目UI规范；只读复核确认多个工具可叠层、部分面板在视口底部裁切、重绘/擦除/标注与底层Creator碰撞、透明图在编辑器/全屏显示黑底、扩图与紧凑面板布局失衡。顶部400×48工具栏、更多菜单和颜色标记基本符合既有基线，作为回归保护。
- 根因冻结为：多套独立open状态缺少互斥；多个面板依附节点`NodeToolbar`而不是screen-space Portal；缺少统一modal/popover/surface、焦点、viewport和透明背景合同。
- R0～R6已完成单一活动状态、Portal `ImageToolHost`、modal inert、焦点返回、共享棋盘格surface、紧凑/大型面板、三目标视口和13张本地浏览器证据；该实现已随v0.6.36发布。
- 主方案：`spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_PLAN_2026-08-24.md`；唯一断点：`spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_CHECKPOINT.md`；新Session Goal：`spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_GOAL_PROMPT_2026-08-24.md`。
- R7独立只读审查报告普通透明上传节点surface、标注tooltip、busy焦点、URL-only裁剪空壳和全工具zoom证据五项缺口；产品/测试候选`39cd494`已按最小范围修正。精确候选safe m2 `10/10`、m18 `2/2`、m100 `13/13 PASS`，source/snapshot`8c3cd1a6…f5b98`、4173 listener unchanged，真实Provider/OSS/费用0。
- 唯一一次safe full在精确`4fd25cc`执行，原始`1050/1052`；两个失败为m24异步目录结果时序和m37在modal inert后使用非法背景编辑前置条件。未重复full；m24在`e2c412e`定向`2/2 PASS`，m37在最终候选`161f417`以真实派生use case直接验证上传后持久化关闭补偿并`35/35 PASS`。当前工程状态`LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`，不把原始full改写成全绿。
- `IMGEDIT-021～028`原R8/R9技术历史继续保留，但用户拒收已覆盖“待确认”结论；本地纠正需新的候选、发布和生产复验后才能重新进入用户验收。
- v0.6.36版本门与发布授权已经执行并消费。本地纠正没有新版本门或发布授权；INC-IMGEDIT-003的6次/60 USD已全部消费，真实Provider成功、尝试和费用预算继续固定为0。
- v0.6.36精确版本提交`72f0b0d`已通过safe m38 `15/15`与m81 `41/41`，合计`56/56 PASS`，source/snapshot`a7613c8e…903a765`；最终冻结候选`c2cbd54`又完成治理文档树m38 `15/15 PASS`，source/snapshot`a5e44a88…64d3`。各轮4173 listener unchanged，Provider/OSS/费用0；未重复R7唯一一次full。
- R8生产：release`/opt/unboundry/releases/v0.6.36-image-tool-ui-remediation-20260824`，inventory SHA`d05c702a…fcd6`；冻结备份`/var/lib/unboundry-rollbacks/v0.6.36-frozen-r8a4f2`的source/restore各366文件且双清单SHA`64e0ed92…143e`。切换前后主库schema39/integrity/FK、Library schema1/integrity/FK和tasks759/attempts767/active0、media800/1436473382、publications390/active0、canvas62、templates50/48、Library2完全一致；公网5资源一致，journal错误0，发布Provider/OSS/费用0。
- R9生产零付费实页技术检查是历史证据；它没有发现随后被用户抽查指出的产品质量问题，因此不能再作为“只剩用户确认”的结论。当前生产质量状态为`USER_REJECTED`，本地纠正尚未发布。

## INC-IMGEDIT-003 图片工具栏剩余能力单 Goal（D13技术完成，用户质量未通过并转INC-IMGEDIT-004）

- 用户已批准最终V5方案并明确启动Goal；D0～D13技术工作已完成，技术状态`V0_6_35_PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS`。用户质量随后未通过，整体转入`USER_QUALITY_REMEDIATION_REQUIRED`，由INC-IMGEDIT-004继续；历史主方案为`spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md`。
- 为防止长任务在新 Session 或上下文压缩后漂移，已建立唯一实时断点 `spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_CHECKPOINT.md` 和可复制 Goal 合同 `spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_GOAL_PROMPT_2026-08-23.md`。D0～D13 每阶段必须先回写断点、矩阵和 TASKS，再继续下一阶段。
- 计划范围包含颜色标记、调整像素、快速分割、标注、个人素材库、多角度、遮罩/重绘、扩图、擦除、增强、主体抠图和 Seedance 素材校验；裁剪只回归，打光继续 `PAUSED`。
- 生产D13冒烟先发现多角度漏传`imageTool`身份，随后重绘暴露六项生成工具共用非法持久输入顺序0；同时确认源节点1K会被模型默认2K覆盖。两次都在Provider前fail-closed，没有task/attempt/Provider和费用。本地热修提交`a411a63`，最终安全定向m100+m2+m27 `43/43 PASS`、外部/Provider请求0。
- 真实付费技术冒烟最多6次、总预算上限60 USD。六项均一次成功、各10 USD，Provider依次为`113882656 / 113886725 / 113888063 / 113888832 / 113889816 / 113890583`；六项均经Media发布、Canvas节点和来源边挂接、云端保存与刷新恢复验证，主体抠图另确认8-bit RGBA和真实Alpha。该证据只证明技术链路，不等于图片质量通过。最终已用6/6、60 USD，不再允许追加真实Provider请求。

## v0.6.33 图片裁剪准备态体验优化（已发布并获用户确认）

- HTTP/OSS图片打开裁剪时显示320×180紧凑加载卡片，不再先撑开大幅空舞台，也不为视觉占位重复读取原图；只有已在内存中的`blob:`/`data:`预览显示缩略图。
- 安全同站编辑源、20 MiB、owner scope、校验、取消、Blob URL和派生上传补偿合同均未改变；安全Blob仍是唯一裁剪和导出数据源。
- 直接受影响m2 `10/10 PASS`；正式full原始`1049/1050`，同源码m22复验`37/37 PASS`。tag、PR、main CI、fresh build、冻结备份、原子切换和生产技术门全部通过。
- 用户已在生产页面完成复验并明确回复“通过”，本功能收口为`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`。

## v0.6.32 图片裁剪同站编辑源（已发布并获用户确认）

- 用户随后明确回复“按 v0.6.32 上线吧”，版本号与生产发布授权均已执行并消费。
- 裁剪编辑器不再直接把可能跨域重定向的素材 URL 画入 Canvas，而是通过 owner-scoped 同站接口读取 local/OSS 原图，校验长度、哈希和 PNG 结构后，以 Blob URL 供预览和导出。
- 客户端使用可替换 resolver；未来可接 `media.mymy.ltd + CDN/CORS`，当前同站接口继续作为私有素材安全兜底。来源 assetId 在打开裁剪时冻结，来源变化或持久化身份漂移时拒绝落图并补偿清理派生资产。
- 自动证据：直接相关定向 `89/89 PASS`；唯一一次正式 safe full 为 `1049/1050`，唯一失败是未修改 m22 的既有缩放时序断言，同一源码隔离复验 m22 `37/37 PASS`。原始 full 不改写成全绿。
- GitHub：功能提交 `ca6bddb`，PR #75 merge `864cd2d`，main Quality gates run `32623969904` 为 `SUCCESS`；注释标签 `v0.6.32` 解引用后指向生产源码 `4cf9d74dec941dea8f10e73bb07de990b668e150`。
- 生产技术门全部通过，权威回执为 `spec/V0_6_32_PRODUCTION_RECEIPT_2026-08-23.json`。用户随后实际裁剪原先报错的OSS图片并明确反馈成功，本功能收口为`USER_PASS`。

## 图片裁剪准备态体验优化（INC-IMGEDIT-002，已随v0.6.33发布）

- 用户确认当前“大黑框+正在准备图片”是可优化体验，并同意“当前图片视觉占位+半透明遮罩+小型加载动画+准备完成淡入”的方向。
- 权威方案与施工记录：`spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md`；状态`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS / VERSION_V0_6_33`。
- 实际行为：`blob:`/`data:`内存预览可作为视觉缩略图；HTTP/OSS图片为避免再次请求大图，显示320×180紧凑加载卡片。两者都只作准备反馈，安全Blob仍是唯一裁剪/导出数据源。
- 改动仅在`ImageNode.tsx`、样式和m2定向测试；服务端、20 MiB、并发、缓存、媒体域名、schema和数据未改。safe m2最终`10/10 PASS`，source/snapshot SHA-256均为`425ff6ab1114589272f792c0cef28fc6171b82b0c6c355e1f6d8de22af8f603c`；本地实页加载/ready状态和空控制台通过。
- 用户已指定小版本v0.6.33并授权commit、push、PR和发布；该授权已完成并消费，用户线上复验也已通过。

## 2026-08-23 治理与 nginx 加固

- 应用版本、release、schema和生产数据保持 v0.6.31/schema39 不变；本轮没有新应用发布、Provider请求或OSS写入。
- 生产 nginx 已隐藏详细版本，并对点文件、源码目录、package/tsconfig和robots路径明确返回404；原配置有只读备份。reload后nginx与`unboundry.service`均active、应用`NRestarts=0`，公网root/version/live/ready均200。
- GitHub已关闭冲突草稿PR #68、删除8条已合并或被取代的远端分支、启用合并后自动删分支和Vulnerability Alerts；main分支保护仍受当前私有仓库套餐限制。
- 治理候选已补权威版本一致性门、nginx安全合同和轻量CI；PR #72已于2026-08-23 squash merge为`f78e7daccd8fce58c3c30a02bc9f27794129933a`，对应main Quality gates run `32615001671`已`SUCCESS`。没有tag或新应用release。
- 没有真实功能触发，第三至第七模块化批次继续保持`NO_ACTIVE_NEXT_BATCH`。完整证据见`spec/UNBOUNDRY_GOVERNANCE_NGINX_HARDENING_RECEIPT_2026-08-23.md`。

## 2026-08-23 服务器运维回执收口

- 同日P0安全加固与低风险磁盘清理没有修改Unboundry应用、schema39、生产业务数据、Provider、OSS或release指针；两份证据分别收口于`spec/UNBOUNDRY_SERVER_SECURITY_HARDENING_RECEIPT_2026-08-23.md`和`spec/UNBOUNDRY_SERVER_DISK_CLEANUP_RECEIPT_2026-08-23.md`。
- 时间线已澄清：安全加固检查点为服务器时间`10:03`，磁盘清理检查点为`10:50`；`76% / 28G available`是清理前状态，后续清理及11:24只读复核均为`61% / 45G available`。
- 11:24只读复核确认生产仍为v0.6.31/schema39，current release未变；SSH密钥登录、UFW、Fail2ban、loopback服务、备份timer、关键服务和公网健康/敏感路径合同均通过，`NRestarts=0`。复核没有生产写入、服务重启、Provider请求或OSS操作。
- 本地docs-only候选在离线安装依赖后通过m38定向`15/15`，source snapshot与4173 listener均不变；没有运行safe full。
- 两份回执已通过docs-only PR #73于2026-08-23 squash merge为`c16139ce3a59092b6ac796ab8953fd3dc243bd27`，对应main Quality gates run `32615533816`已`SUCCESS`。没有tag或应用release；受保护未跟踪JSON继续完全排除。

## VIEW-005 密集画布性能证据已关闭（2026-08-21，仅工程证据）

- 最终被测实现commit `7d436b89e34a77b01b84de4e764d49044ba25fd2`；产品代码、schema和package版本均未修改。
- 正式安全定向命令`node scripts/run-safe-tests.mjs run --spec m79-canvas-smoothness`退出0，精确98/171/200三档3/3通过；Node `22.23.1`、npm `10.9.8`、生产构建、动态loopback端口和fresh系统临时数据目录。
- 三档正常zoom=1均只挂载12个可见节点且小于总数；平移后挂载/可见ID集合均改变；fit后zoom=0.15分别挂载并可见98/171/200全部节点。三档long task>=100ms均0，p95分别9.3/9.2/9.3ms，max分别25/25/17.6ms，dropped分别1/1/0。
- 页面未处理错误、console error、外部请求、generation/Provider/OSS/媒体写请求均为0；每档临时项目finally清理成功，safe runner清理整套临时账号/数据库目录，4173监听者前后不变。
- 该结果只把矩阵`VIEW-005`从`NOT_RUN`改为`AUTO_PASS`。v0.6.30既有`PRODUCTION_PUBLISHED_USER_PASS / USER_PASS`不变；没有新用户主观验收、版本升级、tag、release、生产访问或发布。完整回执：`spec/VIEW_005_DENSE_CANVAS_PERFORMANCE_RECEIPT_2026-08-21.md`。

## v0.6.30 Provider 结果兼容已发布（2026-08-21）

- 用户上传一直支持PNG/JPEG/WebP/GIF；故障只在Provider结果链。Nano真实成片为JPEG，Suno真实响应为两个不同的完整MP3候选。
- 非PNG图片经20MiB/4000万像素/私有临时目录/有界ffprobe+ffmpeg合同转成规范PNG；资源闸门在响应读取之前，资源繁忙保持可恢复语义。
- relay结果接受1至4个同类型输出。所有候选先成为restart-safe published media，整组齐全后才以第一个为primary原子完成task/attempt；不会在主音频成功后静默丢失第二音频。
- 后续alternate不重复成本或成功事件；任务API返回`resultOutputs`，音频节点提供持久版本选择并同步整组成功证明，上传替换会清除旧候选。
- 独立subagent review的三个阻断和两个高风险项均已处理，复审无剩余阻断。唯一一次正式safe full在HEAD `a8c9e8f`、source/snapshot `621ac501…e6b`执行：`1035/1037`通过；只按失败项复验，m38 `15/15`、m2+m4 `4/4`通过，未第二次运行full。m4根因是测试夹具伪assetId被持久化成不存在的API路径，不是生产音频下载合同；夹具已纠正。
- 生产恢复仅限已存在的云腾provider task `112083470`/`112087930`，零新建POST。权威设计：`spec/UNBOUNDRY_PROVIDER_RESULT_COMPATIBILITY_V0_6_30_2026-08-21.md`。
- tag `v0.6.30` 指向 commit `bfed2f79581935882bb58279c8faf992679f12c1` / tree `9a95f30993fc9f21489d1a8acb2e7347d90845c8`；PR #64 merge `0d71d37c77423f3870e97f1e44b9745fef999cfb`。生产 release `/opt/unboundry/releases/v0.6.30-provider-result-compatibility-20260821`，冻结备份 `/var/lib/unboundry-rollbacks/v0.6.30-frozen-1uQmic`。
- 生产恢复后 Nano task 和 Suno task 均 success，attempt 仍为原记录且 `created_at` 已恢复；逻辑媒体由716增至719，字节由1186596417增至1196648534，正好对应1张PNG和2条MP3。公网/loopback version/live/ready、schema39、integrity、FK、service、release inventory、公网5资源与实页播放全部通过。
- 上线后独立review确认无需回滚、无新运行时P0/P1；同时限定这次“临时轮询窗口”是两个已超过deadline历史任务的受控GET-only维护例外，不是普通重启刷新ASYNC-005 deadline的证明。首次启动严格使用原始时间并在发GET前落`RESULT_DELAYED`，维护成功后attempt `created_at`已精确恢复，完整事件号见回执。
- 完整生产回执：`spec/V0_6_30_PRODUCTION_RECEIPT_2026-08-21.json`。

## v0.6.29 已发布，云腾三次真实验收后部分配置回滚（2026-08-21）

- tag `v0.6.29` 指向 commit `d4ccc360e2645e43005c8bdf9a05ec984d48e655` / tree `a291420309236f2b2bb53653301b2b1f1395dbfd`；PR #60 merge `af8493cdf710dc9f899aa098d725e9d034bdb032`，发布时 main tree、tag tree 和 release archive 一致。
- 生产 current：`/opt/unboundry/releases/v0.6.29-yunteng-provider-isolation-20260821`；冻结备份：`/var/lib/unboundry-rollbacks/v0.6.29-frozen-6c2fff`，365 文件，双清单 SHA 均为 `cabcb1c0…c0b5`。
- 发布后终门：service active/enabled、NRestarts0；公网/loopback 0.6.29；schema39、integrity ok、FK0；tasks633、attempts641、active0、模板50/已发布48、逻辑媒体716条/1186596417字节、画布57；5个公网构建资源与 release 逐字节一致，管理页和验收画布控制台 error/warn 均为0。
- 云腾 profile `06831aee…60fdf` 独立存在并保持 enabled，driver=`multi-protocol-relay`、base URL=`https://api.lk888.ai`；profile key、账号凭据身份和目录凭据均 valid，credential version=1，目录129模型，控制面请求2次。
- 三条精确模型均只在云腾：Nano `cb2e1041…2db4`、Kling `3919d490…4760`、Suno `65830fc7…5ec1`。真实验收后 Nano/Suno=`disabled`、binding enabled=0；Kling=`published`、binding enabled=1；三者均非默认、未归档，历史task/attempt保留。
- 三次创建 POST 恰好对应 provider task `112083470`、`112086188`、`112087930`；Provider attempt均只有execution_attempt=1。Nano/Suno一次“核对原任务”只读取既有providerTaskId，没有新增admission或创建POST。Kling产物 `ec4aec38…22d.mp4` 已ready、OSS 3378176字节/5.042秒；Nano/Suno Provider作品已下载到 `/Users/mymy/Documents/unboundry/recovery/yunteng-provider-results-20260821`。
- 优创对冻结备份逐项哈希一致：profile 1、账号凭据身份3、模型/绑定12/12、任务/attempt 281/288；没有读取、复制、覆盖或回退使用优创 key。完整回执：`spec/V0_6_29_PRODUCTION_RECEIPT_2026-08-21.json`。

## 云腾 Provider 隔离纠正（2026-08-21，v0.6.29 代码已发布）

- 用户明确：优创与云腾是两个老板、两套充值余额、两套 API key 和账单，互相完全不能使用；二者只是都接入天空兼容 API。“天空”是技术兼容层，不是默认计费 Provider。
- 发布前只读核对：当时存在优创 profile、没有云腾 profile；优创目录快照中碰巧出现三个 Provider 模型 ID，但 `model_profiles` 没有三条精确模型记录。当前三个内部模型记录和绑定均只归属独立云腾 profile；Nano/Suno因结果格式不兼容停用，Kling保持发布。目录出现本身不证明模型归属，最终以profile/model/binding/task/attempt证据为准。
- 正确数据模型：优创、云腾各自一条 `provider_profiles`；账号凭据继续按 `(account_id, provider_profile_id)` 隔离；相同 Provider model ID 可在两个 profile 下各有独立内部 model ID。三模型本轮明确归属云腾，禁止写入或回退到优创。
- schema39 保持不变。普通 `/api/models` 已安全返回 `providerName`，节点下拉以“模型名 + 商业Provider + capability”区分同名模型并继续按内部 model ID 选择；管理端明确区分商业平台、技术 driver 与 protocol，并禁止既有模型跨 profile 原地重绑。
- 凭据 owner 模式不再回退 profile 全局 key；task/attempt/recovery、relay 自动核对和 Generation 结果提交均把 `provider_profile_id` 纳入严格身份核对。一次独立 subagent review 找出的四项（凭据 fallback、恢复上下文串 profile、结果提交缺 profile、模型身份漂移）已全部修复。
- Node `22.23.1` / npm `10.9.8` 定向有效覆盖：review 后 m12/m56/m57/m73/m88 `78/78 PASS`，TypeScript 退出0；另有 m9/m16/m18/m46 直接覆盖密钥表面、灰阶布局、两字号和多目录UI。全部使用隔离临时数据、动态loopback和fake fetch，真实创建POST为0，4173 listener不变。实现提交：`8f4a2b6 feat(provider): isolate commercial platform identity`。
- 唯一一次正式safe full在HEAD `0f23b19`、source/snapshot `40da52cc…20a`上执行：`1025/1034`通过，9项旧测试夹具/可访问名称失败，退出1；源码快照和4173 listener不变。按合同只复验失败spec，首轮`30/31`，唯一剩余m43修正后`6/6 PASS`；未第二次运行full。测试兼容提交：`19ec414 test(provider): align isolation fixtures`。
- 施工方案：`spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_PLAN_2026-08-21.md`；续接：`spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_CHECKPOINT.md`；Goal 合同：`spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_GOAL_PROMPT_2026-08-21.md`。GitHub与代码发布、凭据配置和三次真实调用均已执行；本版本停止在两模型配置fail-closed，不得再次调用、移动tag或进入v0.6.30。

## v0.6.28 已发布（2026-08-21）

- 用户已分别确认版本号`v0.6.28`与“允许发布”；本次授权已完成并消费。tag`v0.6.28`精确指向commit`ee6ce437730cf78ef4488217b778f6b0ef2aaee5`/tree`2811ada65140779d4a5e10cbd8ed6fa54893638b`；PR #58 merge`753d24f8ee6e4facb3c88e876c4a38b456addc75`且main tree一致。
- 正式safe full执行`1032/1034`：dense-canvas p95 25.3ms超过25ms 0.3ms，m38候选文档精确字符串不符；修正文档后仅复验这两个失败spec并`16/16 PASS`，未重复full。真实Provider/付费/OSS请求为0。
- 生产current为`/opt/unboundry/releases/v0.6.28-relay-media-models-20260821`；冻结备份`/var/lib/unboundry-rollbacks/v0.6.28-frozen-awqsNE`共365文件，双清单SHA均为`2897b65a20419e38ae940b353c3f57112ab352133054052557a06d63f496c58e`。
- 生产门：schema39、integrity ok、FK0、tasks630、attempts638、active0、公共模板50/已发布48、媒体355个/284663380字节切换前后不变；service active/enabled、NRestarts0、应用错误0，公网5个构建资源与release逐字节一致。
- Release第七批只读追踪确认：当前通用发布路径是`RELEASE_RUNBOOK.md`记录的安全runner、精确Git archive、staging fresh build、冻结备份与原子current切换；历史`0.5.2/0.6.0` bridge脚本不是本次v0.6.28发布入口，不做无关治理。
- 权威回执：`spec/V0_6_28_PRODUCTION_RECEIPT_2026-08-21.json`。用户线上实测前保持`USER_RECHECK`。

## 三媒体模型与Generation结果提交边界（2026-08-21，已随v0.6.28发布）

- v0.6.28 发布时点状态为 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；v0.6.29/30 已补齐独立云腾真实验证、结果兼容、生产与用户验收，这些历史能力继续包含在当前 v0.6.33 中；当前聚合状态以本文顶部 v0.6.33 为准。GenerationResultCommit在同一SQLite事务内提交media publication、Provider attempt、task success与event；MediaLifecycle/MediaRegistry不再查询或更新Generation表，TaskStore与Safety运行时循环已解除。
- 模型：`gemini-3-pro-image-preview`、`kling-v3-omni-cankao`、`suno-v4.5`均复用`multi-protocol-relay/media-generate`。Nano/Kling只接受按edge order的图片引用（上限14/7），Suno不接受媒体引用；参数映射、`result_type`、PNG/MP4/音频保存均为fail-closed。
- 异步安全：截止从paid attempt `created_at`计算，Nano/Kling/Suno分别10/75/15分钟，5秒起步且最多10秒；已有Provider task id只查询原任务；提交响应丢失不二次POST；status只在404/405回退；无`refunded:true`不自动付费重试。
- 自动证据：本地Goal冻结十spec最终有效`148/148`；发布阶段另执行正式full覆盖1034条，两个失败经最小复验`16/16`通过。TypeScript、构建、source coverage、外网门禁与生产技术门均通过。
- 隔离和授权：自动测试继续使用新临时目录、动态loopback与fake fetch，4173 listener不变。`REAL_PROVIDER_SMOKE_PAUSED`；发布与生产已按本次授权完成，真实Provider/付费生成/OSS写入仍为0。受保护JSON未读、未改、未暂存、未提交。
- 本地提交：`3144d7a refactor(generation): own media result commits`；第二提交为`feat(generation): add relay media model contracts`。权威方案、矩阵与Checkpoint见`spec/UNBOUNDRY_RELAY_MEDIA_MODELS_INTEGRATION_PLAN_2026-08-21.md`、`spec/UNBOUNDRY_RELAY_MEDIA_MODELS_ACCEPTANCE_MATRIX_2026-08-21.md`、`spec/UNBOUNDRY_RELAY_MEDIA_MODELS_CHECKPOINT.md`。

## 同步文字Provider port（2026-08-21，已随v0.6.28发布）

- v0.6.28 发布时点状态为 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`；该代码持续包含在当前 v0.6.33 生产版本中，不再是待发布工作。同步文字执行已统一经过`TextGenerationProvider`与`TextProviderRegistry`；Generation Task不再按Ark/relay具体文字driver调用adapter。原未使用的媒体形态`GenerationProvider`假抽象已收敛为当前真实port。
- 安全边界：Provider profile/credential继续由原owner解析和租赁；Task协调器继续拥有task、attempt、幂等、reconcile、lease、结果归属与写回；adapter只返回规范化`text + providerUsageTokens`，不获得数据库、TaskStore、Canvas或MediaLifecycle。
- 替换性：m33用可注入fake Provider完成一个task，网络fetch为0、provider-boundary attempt恰好1；未知driver/缺少实现时本地失败且fetch仍为0。
- 自动证据：Node `22.23.1` / npm `10.9.8`下，一次`npx tsc --noEmit`退出0；安全runner定向m33 `8/8`、m39 `3/3`、m44 `8/8`、m53 `23/23`、m57 `14/14`通过，异常0，使用新临时数据和动态loopback端口，4173 listener不变。
- 证据边界：本地第一批没有运行full；v0.6.28发布阶段已执行正式full覆盖与失败spec最小复验，并完成GitHub/生产技术门。未访问真实Provider或付费生成，OSS写入0，schema仍为39。受保护JSON未读取、修改、格式化、暂存或提交。
- 权威文件：`spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md`、`spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`、`spec/UNBOUNDRY_PROVIDER_PORT_BATCH_ACCEPTANCE_MATRIX_2026-08-21.md`、`spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md`。
- 后续：第一、第二与发布追踪批均已随v0.6.28收口；用户页面复验前为`USER_RECHECK`。下一次Provider、发布、push/PR、版本/tag、SSH或生产动作仍需新的明确授权。

## v0.6.27 画布执行解耦已发布（2026-08-21）

- 状态：`PRODUCTION_PUBLISHED_USER_PASS`。用户于2026-08-21明确回复「v0.6.27 验收通过，同步更新为 USER PASS。」四类整组执行已从React节点registration迁移到静态headless executor；`workflowRenderRetention.ts`已删除；同画布不相交组可并行，重叠节点/直接输入在付费提交前阻止。
- 所有权：结果应用必须匹配runId、taskId、ownershipKey、nodeId和kind；checkpoint、lease、lock与摘要按runId隔离且checkpoint写入强制匹配lease runId，一轮不能清除另一轮。手动单节点提交也必须避让同标签活跃组lease；headless executor只放行自己的runId。
- 自动证据：m22 `37/37`、m38 `15/15`、m40 `14/14`、m41 `51/51`、m44 `8/8`、m68 `4/4`均通过。m22直接覆盖四模态headless preflight/run/recover/apply、多run导航/精确checkpoint清理，以及双run反例：A成功、A失败、A停止时B均继续；A整组和两层子节点真实卸载后，第二层仍提交、完成并落盘。运行中无关节点编辑/移动/连接/删除/复制和视图缩放仍可用。
- 最终自动回执：HEAD `26525387ff02a34d8de1eae4d74ed51c11529a7a`执行`node scripts/run-safe-tests.mjs full`退出码0，`119/119 specs、1029/1029 tests`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot SHA均为`bef8b0f3c0204a6634dd45753d0700827eb8df6de0a7abb992f144116cf535d6`，4173 listener未变，受保护未跟踪JSON未进入快照。架构终审P0=0/P1=0，测试终审无新的P0/P1实现阻断。
- 发布身份：注释tag `v0.6.27`精确指向上述tested commit，tree `3735ea655cc9f353b0ccfca1060221cea445ba0e`；PR #55 merge `93f0e46be78d04f7663444c3306f91081051dc9b`，main tree与tag tree一致。生产指针为`/opt/unboundry/releases/v0.6.27-canvas-execution-decoupling-20260821`；冻结备份`/var/lib/unboundry-rollbacks/v0.6.27-frozen-yaet3a`，365文件，双清单SHA均为`fb4efe7f219894c9ff73c9a32c550a1595346024f2c20a69b0365a1f05d95162`。
- 真实页面：新画布`0f92bbc0-b30a-4c1d-bef2-ecf15216ac01`包含A/B两个不相交文字组；并发轮B后A相差557ms启动，页面同时显示两组运行中，数据库时间窗也证明B2未完成时A2已提交。并发轮4 tasks/4 attempts均attempt 1 success且无重复；连同前置A组控制轮共新增6 tasks/6 attempts，active归零。页面分别显示A组2/2用时6秒、B组2/2用时7秒，刷新后A1_OK/A2_OK/B1_OK/B2_OK仍在原节点，已保存到云端，应用console error/warn为0。
- 生产门：公网和回环version均`0.6.27`，service active/enabled、NRestarts0，schema39/integrity ok/FK0；发布前590 tasks/598 attempts，真实验证后596/604，模板50/已发布48，所有5个构建资源与release逐字节一致。权威回执：`spec/V0_6_27_PRODUCTION_RECEIPT_2026-08-21.json`。
- 权威方案、矩阵与施工续接分别见 `spec/UNBOUNDRY_CANVAS_EXECUTION_DECOUPLING_PLAN_2026-08-21.md`、`spec/UNBOUNDRY_CANVAS_EXECUTION_ACCEPTANCE_MATRIX_2026-08-21.md`、`spec/UNBOUNDRY_CANVAS_EXECUTION_CHECKPOINT.md`。

## INC-GEN-012 / v0.6.26 已发布（2026-08-21）

- 状态：`PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`。用户已确认 v0.6.26 并授权上线与一次真实网站技术实测；授权已执行完毕。权威方案见 `spec/INC_GEN_012_VIEWPORT_INDEPENDENT_GROUP_RUN_2026-08-20.md`，生产回执见 `spec/V0_6_26_PRODUCTION_RECEIPT_2026-08-21.json`。
- 已修边界：用户看得到组工具栏并点开始后，组内部分节点初始离屏、运行中平移/缩放/调整窗口或把父组拖出视口，都不再因 React Flow 虚拟化卸载 execution registration 而静默漏跑；全画布虚拟化仍保留。
- 运行中的参与节点、结构及直接外部输入源只读，父组仍可移动；左侧任务面板持续显示进度并可停止后续；刷新后只在 task/ownership/result proof 能严格核对时继续，不能证明时 fail-closed，不盲目重复付费。
- 跨标签用 Web Lock 持有整轮；没有 Web Locks 的浏览器明确阻止整组付费执行。单节点提交/重试也会核对其他标签页的整组租约。
- 自动证据：m22/m68/m79 `39/39 PASS`；正式安全全量 `119/119 specs、1025/1025 tests PASS`，失败/重试/跳过均 0，4173 listener 不变。
- 发布证据：tag `v0.6.26` 精确指向 commit `dc29cc00d5b379e3e8b8cb1746dc6cf85f01c140` / tree `0770cb7c03e335620906d0b3954e510aa30f9bf2`；PR #53 merge `4a675be056aaca4b3d3a3239136857fecbefbb94`，main tree 与 tag tree 一致。生产指针 `/opt/unboundry/current -> /opt/unboundry/releases/v0.6.26-viewport-independent-group-run-20260821`；冻结备份 `/var/lib/unboundry-rollbacks/v0.6.26-frozen-234452`，365 文件，两份清单 SHA 同为 `6b64da90d996446e570a60bc0454ead445defe42df09579787e796e39864b525`。切换前后 schema39/integrity ok/FK0/tasks569/attempts577/templates50/published48/active0 完全一致，公网 5 个构建资源逐字节一致。
- 真实页面证据：画布 `9dd7c462-cc1e-40e9-90c7-8e0131df490e` 启动“一键上新+自检”后把父组拖出屏幕；任务面板仍从“已完成 5/11、正在处理 4”继续到“成功 11、失败 0、跳过 0、未运行 0”，总用时 3:18。生产正好新增 11 tasks / 11 attempts，全部 attempt 1 success，4 图 + 7 文，active0；页面“已保存到云端”，控制台 0 error/warn。尚缺用户主观复验，不能写 `USER_PASS`。

## v0.6.25 发布与真实验证（2026-08-20，历史时点）

- 本节以下为 v0.6.25 历史记录，不承担当前版本播报；当前生产只以本文顶部v0.6.46状态为准。v0.6.26 的 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK` 是该版本独立验收时点，继续作为历史证据保留。v0.6.25 的完整实施记录见 `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`，生产凭证见 `spec/V0_6_25_PRODUCTION_RECEIPT_2026-08-20.json`。
- 事二「生成任务一直排队中」已在线闭环：已知任务 `c479826f-a426-4a11-854c-79ecc802bcbc` 从 `queued / attempt 1 / provider_task_id null` 在 v0.6.25 重启后自动接力，平台任务 `111092189` 完成，最终 `success / attempt 2`；没有盲目重复。
- 事一已查清：2026-08-19 15:23–15:26Z 上游“服装主体标准化”图片成功并产出 11,596,744 字节 PNG；v0.6.23 的 10MB 文字输入预检随后拦下四个下游文字节点，五个后代未运行。不是客户端 DAG 漏发；红字把失败错归因给已经成功的上游图片节点。
- “2:33 三张主图从未提交”的旧说法已被生产任务表与 nginx 202 提交记录否定：该轮 7 图 + 4 文全部 success。
- Ark Files 已补齐失败/取消清理、底层 abort、单次与整体 poll deadline、读取前限流、OSS 流式 20MiB 上限、账号隔离 gate、脱敏结构化日志与安全本地读取。事故画布原节点 `text-932053d1…` 真实引用 `11,596,744` 字节 PNG；agent 在页面点一次生成，任务 `6d304853…` attempt 1 success、4289 tokens、结果 1278 字符；日志 upload/poll(1 次)/delete 全 success，页面显示用时 1:06 和“已保存到云端”，浏览器控制台 0 error/warn。
- Provider 成片保存退避、整组“停止后续”、持久失败摘要、scope 隔离、旧轮次保护、预检双击保护与并行失败映射均已上线。正式安全全量 `119/119 specs、1018/1018 tests PASS`，异常计数 0，最终 v0.6.25 source/snapshot SHA-256 均为 `fa9fa1dbdae1e70dd1c3c308a03e01a68cd11e6280d12682174ae8ba457525b4`；独立子 agent 终审未发现新的 P1/P2。agent 的技术实页通过不等于用户主观 `USER_PASS`。

## 历史线上（v0.6.35 时点，已被v0.6.46取代）

- 地址：https://canvas.mymy.ltd
- 指针：`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.35-image-toolbar-hotfix-20260824`
- 源码：注释tag `v0.6.35`解引用为commit `fc99101327efc8fc3687406598169a6ae7dc1272`，tree `cb13fef2e71e41c3ada09ade95619c9362636b36`
- 标签：`v0.6.35`与`origin/main` tree一致；`origin/main=cc62bfbb155372ba3b1da65c029d9c97b5330ac7`
- 功能 PR：#81，squash merge `cc62bfbb155372ba3b1da65c029d9c97b5330ac7`
- 冻结备份：`/var/lib/unboundry-rollbacks/v0.6.35-frozen-ad7b91`，主库、Library sidecar与媒体恢复副本均已纳入清单
- 上一不可变版：`/opt/unboundry/releases/v0.6.34-image-toolbar-20260823`（以及更早版本）仍保留
- 当前数据门：schema39、integrity/外键/生产切换门均已通过；六项技术冒烟后tasks728、attempts736、active0，真实Provider预算为`6/6 / 60 USD`。
- 生产并发配置已恢复推荐值：per_user 20 / image 10 / video 2 / audio 2 / text 10 / RPM 120
- 正式安全全量：v0.6.35冻结候选唯一一次执行 `1052/1052 PASS`；此前v0.6.34原始full及精确修正复验继续按原始证据保留，不改写
- 生产技术门和真实Provider技术冒烟已完成；用户随后确认图片工具交互/UI未通过，当前为`PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_REMEDIATION_REQUIRED`。v0.6.35版本号与发布授权已消费，下一工程动作只能由INC-IMGEDIT-004新Goal启动

## 历史发布记录（v0.6.25 及更早时点）

**v0.6.25（生成恢复与整组运行加固）**：旧执行挡住自动重试时，退场后可靠接力；Ark Files 完整清理/abort/限流/gate/结构化日志；保存退避完整；整组“停止后续”和失败摘要/隔离/旧轮次保护上线。正式安全全量 `119/119 specs、1018/1018 tests PASS`。生产旧 queued 任务自动接力成功；原事故节点用 11,596,744 字节 PNG 在真实页面完成一次文字生成，Ark upload/poll/delete 全 success。权威凭证：`spec/V0_6_25_PRODUCTION_RECEIPT_2026-08-20.json`。

**v0.6.24（方舟文字模型大图原图直传 Files API，INC-GEN-011）**：火山方舟文字模型引用 10–20MB PNG 参考图时，不再被 10MB 限制拦下、也不再压缩转 Base64，而是原图直传：上传到方舟临时文件后用 file_id 发给文字模型。上传/轮询/删除全程在配置锁外（避免重演线上锁死）；每个优创连接同时最多 2 个大图上传、排队最长 30 秒；超时写死（上传 60s / 等待就绪 120s / 删除 10s）；上传失败不产生计费记录；取消后独立清理信号删除文件不留孤儿；代码默认关闭，但生产已显式打开（`UNBOUNDRY_ARK_FILES_API=1`，systemd drop-in），关闭时旧路径 100% 不变。v0.6.24 发布时真实方舟 12MB 验证通过；当时尚无用户侧 `ark-files-*` 记录。该缺口已由上方 v0.6.25 的 11MB 真实页面验证补齐。

权威方案：`spec/INC_GEN_011_ARK_FILES_API_2026-08-20.md`。权威凭证：`spec/V0_6_24_PRODUCTION_RECEIPT_2026-08-20.json`。

**v0.6.23（生成稳定性根治修复）**：针对 v0.6.22 上线后仍反复出现的卡住/红字问题，本轮从全局根治：1）优创固定通道的轮询、提交、恢复全部接上配置锁释放边界，发起平台请求即释放配置锁，不再长时间占用；2）保存保险丝改为有界重试（5 次退避：1s/2s/4s/8s/15s），锁忙不再被误判成「平台配置已变化」；3）服务端每 30 秒自动扫描「有平台任务号但本地未收片」的旧任务并自动 resume（只回收、绝不重新付费提交）；4）前端锁忙自动重试、画布保存最长自动等 90 秒、取消用持久化任务号兜底；5）生产并发配置从 500 恢复为推荐值（20/10/2/2/10/120），消除放大器。已随 v0.6.23 上线，2026-08-19 发布，待你打开线上页面复验。

权威凭证：`spec/V0_6_23_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.22（四合一生成稳定性修复，已被 v0.6.23 根治版取代）**：1）同一输入已有平台任务已受理/已出片时禁止重复付费提交，只允许先「核对结果」，避免重复扣费；2）成片保存失败按瞬时/终局分类：瞬时错误继续后台核对/轮询并保持呼吸灯，终局错误按任务原样收口，不再把「还在尝试」误判成红字；3）手动/自动重试共用同一道同输入防重判断；4）切换模型时保留已选比例与画质。已随 v0.6.22 上线，2026-08-19 发布，待你打开线上页面复验。

权威凭证：`spec/V0_6_22_PRODUCTION_RECEIPT_2026-08-19.json`。

## 历史模板数据变更（2026-08-19 时点）

- 新增公共模板「电商服装详情页组图（6张·1:1）」（id `e6b7f8c4-8c7d-4f8e-9d0a-3a1b2c3d4e5f`）：白底图输入 + 精品提示词母版 + 6 个 1:1·2K 出图节点（正面整体、领口/腰头与开口结构、袖口/下摆与收口边缘、细节与辅料、面料肌理、缝线与工艺）；提示词已改为通用服装描述（不写死某一款式），母版节点 contentOnly 不参与生成执行。
- 走「加模板轻量路径」：不需要版本号、不打标签、不跑全量；初版源码 commit `ad610b6`，PR #42 合并（merge `b18742a9`）；v0.6.22 发布时用 `scripts/apply-public-template-seed.mjs --update-existing --apply` 更新生产库（published 保持 47），schema39、服务 active，公网预览图 200。
- 规矩已写入 `上线规矩.md`（加模板轻量路径）；`RELEASE_RUNBOOK.md` 适用范围已注明。
- 状态：`PENDING_USER_RECHECK`（2026-08-19 已灌库，待用户在线上页面确认）。

**v0.6.21（通用保存保险丝）**：平台已经生成成功、但我们这边保存成片时遇到瞬时问题（网络断、下载超时、平台暂时拿不到、资源忙、媒体状态冲突），不再判红，任务继续后台核对/轮询并保持呼吸灯。所有平台/模型共用同一道保险丝：图片（relay/优创 GPT Image）、视频（relay/火山 Seedance 原生）、音频（relay/Mureka）全覆盖；非瞬时错误与坏文件仍原样拦截，不把坏图存进去；重试只重新下载保存，不会重复提交平台生成、不重复扣费。已随 v0.6.21 上线，2026-08-19 你已回复「通过」。

权威凭证：`spec/V0_6_21_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.20（生成稳定性一次性修复，INC-GEN-010）**：生成流程少红字、少手动操作。图片主轮询 5 分钟、视频 8 分钟，主窗结束后后台继续慢速核对；任务号丢失自动从用量记录找回，确认缺失时整个任务只自动补提交一次；平台退款自动确认并重试一次，未确认退款不自动发起新付费；只有明确拒绝/本地问题才红字，超时/没出片走中性提示；结果下载网络/5xx 自动重试 3 次；熔断按账号拆分；画布保存等待放宽到 15 秒、按钮显示「正在保存画布…」。已随 v0.6.20 上线，2026-08-19 你已回复「通过」。

权威方案：`spec/INC_GEN_010_GENERATION_STABILITY_2026-08-19.md`。权威凭证：`spec/V0_6_20_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.19（验收收口）**：记录 v0.6.17/v0.6.18 用户复验通过、版本号升至 0.6.19、运行时放行新版本；无产品功能改动。已随 v0.6.19 上线，2026-08-19 你已回复「通过」。

权威凭证：`spec/V0_6_19_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.19（验收收口）**：记录 v0.6.17/v0.6.18 用户复验通过、版本号升至 0.6.19、运行时放行新版本；无产品功能改动。已随 v0.6.19 上线，待你打开线上页面复验。

权威凭证：`spec/V0_6_19_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.18（UI 对齐）**：管理员后台「优创尺寸映射」面板样式对齐项目暗黑 UI，比例输入支持下拉建议，说明文案改成人话；出图逻辑不变。已随 v0.6.18 上线。2026-08-19 你强制刷新后回复「通过」。

权威凭证：`spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json`。

**INC-GEN-008**：选优创专用协议的 2K/4K 时，按优创文档像素发 `size`，不再偷换成 1024×1536。默认已改为 1K（生产配置已改）。旧格子已选 4K 的按真 4K 发。未知组合说人话拦截。「新增参数直发收费口」本轮不做。OpenRouter 出图用户说先算了，不要续。2026-08-19 你确认真 4K 已成功出一张，并回复确认项通过。

**INC-GEN-009**：管理员后台可编辑「画质档 × 比例 → 像素」，只对优创 gpt-image 生效，新格子按管理员填的像素真发；没填回退内置表；非法/未知组合整单拒绝、不发不扣费。已随 v0.6.17 上线。2026-08-19 你回复「通过」。

权威方案：`spec/INC_GEN_008_YOUCHOANG_GPT_IMAGE_SIZE_2026-08-18.md`、`spec/INC_GEN_009_ADMIN_EDITABLE_GPT_IMAGE_SIZE_MAP_2026-08-19.md`。权威凭证：`spec/INC_GEN_008_009_PRODUCTION_RECEIPT_2026-08-19.json`、`spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json`。发布授权已消费；下一次发布仍要分别说版本号和「可以上线」。

## 站着的产品合同

1. 用户上传一张图，点整组，流程自己走完，结果自己留下来下载。
2. 没有证据证明平台已经在出图，就不能写「已向模型提交」，也不能挡住自动再试。
3. 整组碰到可恢复失败：自己核对；对得上就收回；确认没成片就自动再试 **1 次**；对不上/还在做就停住。
4. 同一格同一套输入，真等到超时还没对上，不许再点出一张新付费单。
5. 视频仍是提交 + 轮询。GPT Image 2 是一次 HTTP 出图，没有视频那种任务列表。
6. DATA-005：跨标签最后保存者胜。不恢复金额/额度/订阅。普通账号五项默认权限不可撤。

## 这一轮已经收口的修复（由近到远）

| 版本 | 编号 | 用户要的结果 | 验收 |
|---|---|---|---|
| v0.6.23 | 生成稳定性根治修复 | 释放配置锁、保存有界重试、锁忙不误报、服务端自动恢复旧任务、前端自动兜底、并发恢复推荐值 | **USER RECHECK**（2026-08-19 已发布待复验）；全量 118/994 PASS |
| v0.6.22 | 四合一生成稳定性修复 | 同输入防重扣费、保存失败瞬时/终局分类、手动/自动重试统一、切换模型保留比例画质 | **USER RECHECK**（2026-08-19 已发布待复验）；全量 118/991 PASS |
| v0.6.21 | 通用保存保险丝 | 平台成功但本地保存失败不再红字：所有平台/模型共用，瞬时错误继续轮询保持呼吸灯 | **USER PASS**（2026-08-19 回复「通过」）；全量 118/986 PASS |
| v0.6.20 | INC-GEN-010 | 生成稳定性一次性修复：不红字、保持呼吸灯、自动核对/再试、画布保存提示 | **USER PASS**（2026-08-19 回复「通过」）；全量 118/983 PASS |
| v0.6.19 | 验收收口发布 | 记录 v0.6.17/18 用户复验通过、版本号收口、运行时放行 | **USER PASS**（2026-08-19 回复「通过」）；全量 118/983 PASS |
| v0.6.18 | INC-GEN-009 UI 对齐 | 后台尺寸映射面板样式对齐、比例下拉、文案白话 | **USER PASS**（2026-08-19 回复「通过」）；全量 118/983 PASS |
| v0.6.17 | INC-GEN-009 | 后台自改优创尺寸映射，新格子真发 | **USER PASS**（2026-08-19 回复「通过」）；全量 118/983 PASS |
| v0.6.17 | INC-GEN-008 | 优创专用协议按文档尺寸出 2K/4K | **USER PASS**（2026-08-19 回复「通过」）；全量 118/983 PASS |
| v0.6.16 | INC-UI-010 | 管理员打组后可直接发成公共模板 | **USER PASS**（2026-08-18 回复「通过」） |
| v0.6.15 | INC-GEN-007 | 假提交不再挡住；整组自己核对或再试一次 | **USER PASS**（2026-08-18 回复「通过」） |
| v0.6.14 | INC-GEN-006 | 过期「画布还在保存」不再挡整组 | **USER PASS**（2026-08-18 回复「全通过」） |
| v0.6.13 | INC-GEN-005 | Mini 时长/清晰度能改、能保存 | USER PASS |
| v0.6.12 | INC-GEN-004 | 整组节点跑完先存稳再给下游 | **USER PASS**（2026-08-18 回复「全通过」） |
| v0.6.11 | INC-UI-009 | 整组下载改走数据盘 | USER PASS |
| v0.6.10 | INC-UI-008 | 文字全屏改画布遮罩 | USER PASS |
| v0.6.9 | INC-GEN-003 | 失败后自动配对平台用量 | USER PASS |
| v0.6.8 | INC-GEN-002 | 同层提交排队，避免互相报保存中 | USER PASS |
| v0.6.7 | INC-GEN-001 | 生成用时 + 画布核对结果 | USER PASS |
| v0.6.6 | INC-UI-007 | 组标题、文字平移、模板目录刷新 | USER PASS |
| v0.6.5 | INC-UI-006 | 缩放时坐标不乱漂 | USER PASS |
| v0.6.1 | INC-ECOM-007 | 整组按依赖自动往下跑 | USER PASS |

更早的电商模板、封面、真实生成补验、schema37→39、备份/OSS 保留，都已按当时 receipt 收口。不要改那些时点数字。

## 旧项用户验收（2026-08-18 一并收口）

用户明确回复「全通过，这几个全部都通过」。下列已在线上、原先仍标 `USER_RECHECK` 的旧项，现全部收口为 **USER PASS**：

- INC-GEN-006 / v0.6.14：过期「画布还在保存」
- INC-GEN-004 / v0.6.12：整组存稳
- INC-UI-005 / v0.6.4：组标题总览层级
- INC-UI-004 / v0.6.3：节点标题缩放可读
- INC-UI-003 / v0.6.3：模板 UI 与旧画布会话
- INC-UI-001 / INC-UI-002 / v0.6.2：设置返回、框选、媒体失败态、长标题
- INC-VIDEO-001：真实视频结果

这不等于把别的未点头条目自动升级，也不改那些发布当时的时点数字。

## 接着干活时的硬规矩

- 用中文，像跟朋友说话，别拽术语。先给结论。
- 改文件前先说改什么。删东西必须先问。
- 测试不准碰 `4173`、`app/data`、`/var/lib/unboundry`、真实媒体/备份。
- 不准擅自真实付费生成、改生产库、动 OSS。
- 没分别听到「版本号」和「可以上线」，不准发布、不准 push/tag/PR。一次授权只用一次。
- 查网页优先用本机 `firecrawl`。
- 新项目放 `~/Desktop/Projects/<项目名>/`。这个仓库继续在 `/Users/mymy/Documents/unboundry/app`。
- 用户不懂技术、脾气急。先当产品经理听他要的结果，不要追问一串技术细节。

## 新会话默认动作

1. 先读本文 + `上线规矩.md` + `TASKS.md` 顶部。
2. 只读核对`pwd`、所有worktree、分支、HEAD、`main = origin/main`、工作树和`package.json`；不得仅凭目录名认定`/Users/mymy/Documents/unboundry/app`是当前仓库。2026-08-26核验时，当前干净main为`12e2fd9b…2795`，旧`/app`不得施工或清理。
3. 只读核对公网`/api/version`、`/api/health/live`、`/api/health/ready`与最新生产回执；2026-08-26已确认生产v0.6.46/schema41、INC-GEN-015为`USER_PASS`。时间敏感结论必须重新核验，不能只抄本文。
4. 普通shell默认应为Node `25.9.0` / npm `11.12.1`；Node `22.23.1` / npm `10.9.8`只允许安全测试/源码覆盖/release builder生产兼容通道。生产当前Node `22.23.2` / npm `10.9.8`未经新版本和发布授权不得迁移。
5. INC-GEN-015已完成且无活动下一动作；v0.6.46一次性发布授权已消费。未获新授权不得commit、push、tag、PR、SSH、发布、改生产或发起真实Provider/OSS/Generation写入。
6. 云腾三模型只归属云腾Provider；不得借用优创密钥、不得新增计费Provider、不得自动追加真实Provider POST。若生成或工作流再次异常，先只读核对task/profile/attempt/result所有权，再提新方案。
