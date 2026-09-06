> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-GEN-015：老画布孤立生成态与终态结果自动收口实时断点

更新时间：2026-08-26

状态：`R0_R6_COMPLETE / PRODUCTION_V0_6_46_USER_PASS / TARGET_RECONCILIATION_PASS / ROLLOUT_ON`

权威方案：`spec/INC_GEN_015_LEGACY_CANVAS_ORPHAN_GENERATION_STATE_RECONCILIATION_PLAN_2026-08-26.md`

## 1. 当前身份

| 项目 | 当前值 |
|---|---|
| 真实仓库 | `/Users/mymy/Documents/unboundry/app` |
| 实现工作树 | `/private/tmp/unboundry-inc-gen-015-legacy-terminal-reconcile-20260826` |
| 当前回执分支 | `codex/inc-gen-015-v0.6.46-production-receipt` |
| 实施基线 | `origin/main@49197fb36924b4df11a8c39236275a4ceec8c553` |
| 工作树文档基线 | `0813e6283b12418b19fcf8be7fc04becee424336` |
| package / schema | `0.6.46 / 41` |
| 生产 | `v0.6.46 / schema41`，`/opt/unboundry/current`指向fresh tag release，service active+enabled、NRestarts0；目标allowlist与`on/off/on`通过，最终mode=`on` |
| 固定运行时 | `Node 22.23.1 / npm 10.9.8` |
| 4173 | 既有监听哈希`24c91e57…8244`，所有安全运行前后不变 |
| v0.6.45 | PR #105已合并；不可移动tag与GitHub Release已发布；生产已部署 |
| v0.6.46 | PR #107与PR/main Quality CI通过，merge`c961cee`；不可移动tag/GitHub Release和生产发布完成 |

受保护`spec/public-templates-director-split-revision.json`未读取、修改、暂存、移动或删除。真实主工作树和其他工作树的用户改动未清理或覆盖。

## 2. 已完成

- [x] 读取用户Goal目标并核对仓库、分支、HEAD/tree、package/schema、生产版本和v0.6.45占用；身份一致后启动正式Goal。
- [x] 在原方案工作树创建独立文档保存分支，显式暂存且提交5份用户确认方案文档。
- [x] 从最新`origin/main`建立新的实现工作树并cherry-pick文档保存提交；内容哈希一致，未丢失或降级。
- [x] 冻结零费用边界：Generation POST 0、Provider submit 0、Provider probe 0、Media/OSS测试写0、费用0 USD。
- [x] R1～R3实现完整候选判定、全部checkpoint精确优先、只GET原task、有界3 worker、五态UI、全局提交阻断和四类节点共享显示合同。
- [x] success只复用既有结果投影并校验owner/ready/checksum/result/input/节点数据指纹；终态冲突或结果不完整走owner-scoped服务端原子`terminal-detach`。
- [x] 服务端灰度`off/detect/allowlist/on`、精确owner/task/terminal/binding、事务内最新Canvas CAS、applicationId幂等和字段白名单完成；schema保持41。
- [x] 无Web Locks时零写；unknown、权限、网络、格式异常保持中性阻断；任何路径都不自动重提Generation或Provider。
- [x] package/lock/final runtime role同步为v0.6.45，OpenAPI新增两条owner-scoped接口。
- [x] TypeScript、`git diff --check`通过；m41 `52/52`、m22 `40/40`、m85 `27/27`、m20 `1/1`、m81 `41/41`通过。
- [x] m22/m85/m20/m81同一源码快照`d604f443…a8a4`；m41在产品逻辑相同、仅后续m85测试增强前快照`98a391a8…b87`通过。所有安全运行均为临时数据、动态loopback、fake边界，4173不变。
- [x] m85节点数据指纹漂移用例证明检测后编辑节点时服务端返回binding conflict且零写；首轮因测试自身applicationId构造错误得到400 fail-closed，修正测试后`27/27 PASS`。
- [x] 当前真实Generation POST、Provider submit/probe、Media/OSS写和费用均为0。
- [x] 首轮独立只读终审诚实记录为`NO-GO / P0=0 / P1=4`：缺少active/unknown有界重读、旧状态可能跨新生成残留、task归属证明不足、OpenAPI required/properties矛盾。
- [x] 4项P1均已关闭：每scope仅GET原task并有界重读/导航abort；无legacy绑定时旧状态不再覆盖新生成；task input/ownership/run精确匹配；projection/detach OpenAPI必填集合与properties一致。
- [x] 终审修复中另发现并关闭无result的success会在分类时抛异常的问题，现按`CONFLICT_PRESERVED` fail-closed，避免中断后续active重读。
- [x] 修复后同一源码快照`e4962ca392e5f3ac486be05f1b147e959bcaf60b46217f35dcad253a2e359ca8`：m41 `52/52`、m22 `40/40`、m5 `21/21`、m20 `1/1 PASS`；TypeScript退出0，4173监听哈希仍为`24c91e57…8244`。
- [x] 同一独立线程第二轮复核诚实记录为`NO-GO / P0=0 / P1=2`：classifier unknown/无锁/write-disabled未全部有界重读；scope cleanup未abort且policy GET无deadline。
- [x] 第二轮2项P1均已关闭：所有UNKNOWN/不可写分支按1/2/4秒有限重读原task并静态阻断；scope cleanup真实abort；policy GET具备10秒transport deadline。
- [x] 第二轮修复后同一源码快照`8b1e93e1d1e9b2029d053195ead98b047ad7c07c6d0f6ec8e5c8c92acddb3896`：m41 `53/53`、m22 `41/41 PASS`；新增classifier mismatch→无Web Locks有界停止、零Generation/零reconciliation写、policy deadline及cleanup abort证据；4173不变。
- [x] 同一独立线程第三轮复核诚实记录为`NO-GO / P0=0 / P1=2`：malformed rollout policy未被运行时拒绝；Canvas admission内deferred分支未安排重读。
- [x] 第三轮2项P1均已关闭：共享policy解析器严格验证对象、mode、writeEnabled与组合并fail-closed；admission内匹配lease延迟到期后按同一scope重读原task；签名变化不再误清其他scope预算。
- [x] 第三轮修复后同一源码快照`5f28ce2349b3e46d781631fd773b36d0760e05ed9bbac7ab82ecf06ae19b11c1`：m41 `54/54`、m22 `41/41 PASS`；新增deferred恢复、malformed policy fail-closed与零Generation证据；4173不变。
- [x] 同一独立线程第四轮复核诚实记录为`NO-GO / P0=2 / P1=2`：policy额外字段未拒绝；其他活动run lease未阻断旧detach；projection旧完整快照可能覆盖并发用户编辑；terminal-detach success proof未精确绑定权威resultKey。
- [x] 第四轮4项阻断均已关闭：policy严格键集合；锁外和Canvas admission内均检查同节点其他活动run；projection事务要求当前revision精确等于observed revision并以新GET重试保留编辑；服务端由task result派生权威resultKey，与请求和节点proof三方精确匹配。
- [x] 第四轮修复产品源码快照`172e053d09bcd4b68bee5eb4b518ad4dace5162025fe1b8dc44708949ff6af1f`：m41 `54/54`、m22 `41/41`、m20 `1/1 PASS`；仅增强m85测试后的当前快照`15a5564ea6229d9f64a7c3a9dbcf09bae1c567110976fa427fd376edfdb857b3`下m85 `27/27 PASS`。TypeScript与diff门退出0，4173不变。
- [x] 同一独立只读线程第五轮逐项确认第四轮4项均`CLOSED`，最终`P0=0 / P1=0 / GO`；未发现新的重复付费、unknown解锁、无Web Locks写、活动任务误清、结果覆盖或跨owner/API语义缺口。审查零写、零测试、零网络、零生产操作。
- [x] 冻结候选commit`f243e8eab0d534f9c7c0518b3898f6cd67857057`/tree`2c8ae98bb1869e7454e5b96849ee9116e4ee04f0`完成本Goal唯一safe full：`121/121 specs、1069/1069 tests PASS`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot`df8cdec086998654d8635cedb433737b100fed7389ca1073cbc2d059999a3d68`，4173监听哈希`24c91e57…8244`不变。不得运行第二次full。
- [x] GitHub PR #105、PR/main Quality CI、merge`72e1b60`、tag/Release `v0.6.45`完成；fresh tag构建5983文件、inventory`fe7b1c8e…7c5c`。
- [x] 冻结备份/恢复各366文件且manifest`89a1fa12…380b`一致，schema41/integrity ok/FK0；原子切换后公网/回环v0.6.45、service active+enabled/NRestarts0。
- [x] detect与技术Canvas allowlist实页零写；全部数据账本不变，零Generation/Provider/Media/OSS/费用。
- [x] 当前灰度已限制为目标owner`zzx`+目标Canvas；可控浏览器当前登录`mymy`，owner隔离重定向正确，未读取Cookie/localStorage/Profile，目标仍revision327/graph52与5候选节点。
- [x] 用户明确确认凭据提交后，Chrome与内置浏览器均以`zzx`打开目标Canvas；页面识别5个候选并最终显示静态`UNKNOWN_BLOCKED / 状态待核对`。
- [x] Chrome CDP与服务端日志共同证明5个候选各3次有界projection，共15个Canvas PUT全部返回`400 CANVAS_DOCUMENT_INVALID`；请求内`inputFingerprint`为1644字符原始JSON/中文生成输入，v0.6.45投影校验错误限定为ASCII且最多512字符。
- [x] 该生产P1严格fail-closed：15次PUT零成功、5个旧binding未变化、原5个task仍success；目标Canvas没有新Generation task/provider attempt/media/publication/费用。全局新增任务和媒体来自其他owner，不归因于本Goal。
- [x] 补丁commit`ff3d139f1aceba1fd02b406bdd0fa5290175ea0e`/tree`c58692ddde5be0bd7b8e74e90ac8f349de3d0659`仅统一projection与terminal-detach的opaque input fingerprint合同：非空、最多100000字符；其他账号/任务/节点/ownership/application/semantic/CAS校验不放宽，detach body保留1MiB上限。
- [x] 补丁定向证据：Node22.23.1/npm10.9.8，TypeScript和diff门退出0，safe m20 `1/1`、m85 `27/27 PASS`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot`3828c8e32200b68d74d3783add78e462d2d79edf37f5652ec3d015fe0401f1c6`，4173不变；唯一full未重复。
- [x] 新独立终审首轮诚实结论`NO-GO / P0=0 / P1=1`，发现terminal-detach同样拒绝JSON指纹且16KiB body不足；修复后同线程复审`P0=0 / P1=0 / GO`，并确认大于16KiB Unicode JSON及100001超限拒绝证据。
- [x] 文档同步后的治理m38首轮`14/15`只因CURRENT_STATE生产句式未命中既有正则；修正后最小复验`15/15 PASS`，异常0，source/snapshot`92b712e5daa4d126ad41d0ccdd3472a4dc2fc5b1362ce47fc4d9e36b7a63991e`、4173不变；未重复业务spec或full。
- [x] 用户明确确认以v0.6.46继续发布；package/lock/final runtime role已同步，schema保持41。TypeScript、diff门和safe m81 `41/41 PASS`，source/snapshot`c5ba0228adc65fcc72c59d5c2a2dd613de2ae8f949177141634ed0e404d50aec`、4173不变；版本文档m38修正唯一候选标记后`15/15 PASS`，source/snapshot`a0251547743750ffbbc032304ae83d5bc33263728b82fc880e08639ffbabb9dc`、4173不变；未重复唯一full。
- [x] v0.6.46候选commit`78b5f8af7b9324e7974f2319b81589c34335f29f`/tree`80378c4d1a1cfae02f606a2a2244208922c89977`经PR #107、PR/main Quality CI、merge`c961cee5eb340f731e6e330a316bc2d79e1e9f55`进入main；annotated tag对象`0ce3278…3e45`peeled到merge，GitHub Release已发布且未移动。
- [x] fresh tag archive SHA`b2b4567c…e3f3`在生产构建为5978文件、inventory`50c8bd13…88c2`；首次构建在切换前因npm子进程继承Node18失败，固定`/opt/node22/bin`后只重跑失败构建，生产始终保持v0.6.45健康。
- [x] 60秒静默门`03:26:26Z→03:27:26Z`期间tasks825/attempts833/active0、latestAttempt、目标revision336/graph52均不变；冻结backup`v0.6.46-cutover-final-hrYwLG`的source/restore各366文件，manifest`a15b3626…e7cf`一致，schema41/integrity ok/FK0。
- [x] 带自动回退trap的原子切换完成；公网/回环v0.6.46、live/ready active、schema41、service active+enabled/NRestarts0，release inventory复核不变，新应用warning0。
- [x] zzx目标allowlist实页复验将5个旧候选全部绑定原success task/result proof；Generating均false，task/ownership/input/run旧binding均清空，页面`状态待核对=0 / 生成中=0`。
- [x] 目标Canvas由revision336/graph52收口到343/58；39节点、73边、节点ID、连线文档、viewport、位置与父子关系不变，只有5个候选的结果和收口字段变化。一个正常409 revision冲突从新GET安全重试后成功，没有400校验失败。
- [x] target tasks10/attempts10与原5个success task不变；global tasks825/attempts833/active0/media855/publications445/canvases68不变；Generation POST、Provider submit/retry、Media/OSS、publication和费用均0。
- [x] rollout依次完成首次`on`、`off`止写回退、最终`on`；每阶段重载已收口目标Canvas均revision343/graph58不变，Canvas PUT0、Generation/Provider/Media/publication POST0。最终生产mode=`on`。
- [x] 最终生产回执与当前治理同步后的safe m38 `15/15 PASS`，failed/skipped/retries/blocked/reportErrors均0；source/snapshot`750654cbcdf68467fe4dd3d9d54a95d55a40ef39e70dab563c2c143ce91ece28`、4173不变；未重复业务spec或唯一full。
- [x] 权威回执：`spec/V0_6_46_PRODUCTION_RECEIPT_2026-08-26.json`；本Goal工程、GitHub、发布、目标技术灰度和回退门全部完成。
- [x] 用户在生产目标Canvas目视复验后明确回复“通过”；INC-GEN-015升级为`USER_PASS`，且本确认不改写其他独立待复验项。
- [x] USER_PASS治理同步仅运行safe m38，`15/15 PASS`且异常0；source/snapshot`f5c542e1…33b8`、4173不变，未重复业务spec或唯一full。

## 3. 当前阶段

v0.6.46/schema41已在线且服务健康；目标5个旧节点均复用原成功结果完成收口，零新任务/Provider/Media/publication/费用。`on → off → on`回退门已验证，最终mode=`on`。用户已明确确认生产实页，本项为`USER_PASS`。

## 4. 唯一下一动作

无活动下一动作；本Goal已完成。不得移动v0.6.45/v0.6.46 tag、重复本Goal唯一full、追加真实生成或复用已消费的发布授权。
