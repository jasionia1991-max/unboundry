# INC-GEN-015：老画布孤立生成态与终态结果自动收口实时断点

更新时间：2026-08-26

状态：`R0_R6_PARTIAL / PRODUCTION_V0_6_45_TARGET_GRAY_FAIL_CLOSED / HOTFIX_LOCAL_GO / NEW_PATCH_VERSION_AUTHORIZATION_REQUIRED / USER_RECHECK`

权威方案：`spec/INC_GEN_015_LEGACY_CANVAS_ORPHAN_GENERATION_STATE_RECONCILIATION_PLAN_2026-08-26.md`

## 1. 当前身份

| 项目 | 当前值 |
|---|---|
| 真实仓库 | `/Users/mymy/Documents/unboundry/app` |
| 实现工作树 | `/private/tmp/unboundry-inc-gen-015-legacy-terminal-reconcile-20260826` |
| 实现分支 | `codex/inc-gen-015-long-fingerprint-hotfix-2026-08-26` |
| 实施基线 | `origin/main@49197fb36924b4df11a8c39236275a4ceec8c553` |
| 工作树文档基线 | `0813e6283b12418b19fcf8be7fc04becee424336` |
| package / schema | `0.6.45 / 41` |
| 生产 | `v0.6.45 / schema41`，`/opt/unboundry/current`指向不可变v0.6.45 release，service active+enabled、NRestarts0；target-only allowlist灰度失败关闭，未进入`on` |
| 固定运行时 | `Node 22.23.1 / npm 10.9.8` |
| 4173 | 既有监听哈希`24c91e57…8244`，所有安全运行前后不变 |
| v0.6.45 | PR #105已合并；不可移动tag与GitHub Release已发布；生产已部署 |

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

## 3. 当前阶段

v0.6.45已发布且服务健康，但目标owner实页灰度暴露长原始输入指纹校验P1，15次安全投影均400失败关闭；没有目标生成、Provider、媒体、费用或5个binding变化，也没有进入`on`。本地补丁已定向PASS并独立终审GO。v0.6.45 tag/Release不可移动，原一次性发布授权已消费，因此新不可变补丁版本是当前发布硬门。

## 4. 唯一下一动作

取得新的不可变补丁版本授权；随后才允许同步版本、push/PR/CI、创建新tag/GitHub Release、fresh部署并再次执行目标allowlist验收。不得移动v0.6.45、直接覆盖生产release、运行第二次full或提前扩大到`on`。
