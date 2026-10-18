> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](../../spec/UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](../../spec/PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# Unboundry 云腾 Provider 隔离 Goal Checkpoint

更新日期：2026-08-21

当前状态：`HISTORICAL_V0_6_29_CHECKPOINT / GOAL_COMPLETE / SUPERSEDED_BY_V0_6_30_USER_PASS`

本文件是 v0.6.29 Goal 的冻结施工记录，不再是当前可变续接点。v0.6.30 已在零新增 Provider POST 下修复 Nano JPEG 与 Suno 多音频结果并获用户验收；当前恢复入口是 `spec/UNBOUNDRY_CURRENT_STATE.md`。不得从本文件重启旧 Goal、恢复三次 POST 预算或把失败模型回退到优创。

## v0.6.29 冻结身份

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- 文档落笔 HEAD：生产回执提交前的 v0.6.29 发布分支
- 文档落笔 origin/main：`af8493cdf710dc9f899aa098d725e9d034bdb032`
- 发布 tag commit：`d4ccc360e2645e43005c8bdf9a05ec984d48e655`；tree：`a291420309236f2b2bb53653301b2b1f1395dbfd`
- package：`0.6.29`
- 生产：`v0.6.29 / schema39`；current=`/opt/unboundry/releases/v0.6.29-yunteng-provider-isolation-20260821`
- 目标：`v0.6.29`（已发布，不进入 v0.6.30）
- 受保护文件：`spec/public-templates-director-split-revision.json`，禁止读取/修改/暂存/提交

上述身份只用于复核 v0.6.29 历史证据；任何新 Goal 都必须重新取得用户授权并从当前 Git/生产事实建立独立身份。

## 当前事实

- 优创与云腾是独立商业 Provider，余额、key、账号凭据和账单不互通；
- 两者只是在技术上使用天空兼容中转 API；
- 生产有彼此独立的优创和云腾 profile；云腾 driver=`multi-protocol-relay`、base URL=`https://api.lk888.ai`，profile key、账号凭据和catalog均valid，目录129模型、控制面请求2次；
- 三个目标模型均只归属云腾、protocol=`media-generate`、非默认；Nano/Suno因真实结果格式失败已停用，Kling保持发布；
- v0.6.29代码在线；云腾有1个账号凭据身份、3个model/binding、3个task/attempt、3个providerTaskId；Provider创建POST预算恰好3次且已耗尽；
- schema39 已能表达 profile、credential、model、task 和 attempt 隔离，默认无需 migration；
- 普通 `/api/models` 和节点下拉的 Provider 标签已实页验收；停用后的Suno/Nano原节点明确显示“原模型不可用”且Generate禁用，Kling成功结果仍可播放。

## 阶段清单

- [x] Stage 0：重新冻结Git、运行时和生产只读基线
- [x] Stage 1：公共模型目录返回安全 Provider 身份
- [x] Stage 1：节点下拉与ARIA可辨认同名 Provider 模型
- [x] Stage 2：固定目录/凭据/task/attempt/recovery跨Provider隔离测试
- [x] Stage 2：管理端术语和操作确认不混淆商业平台与技术通道
- [x] Stage 3：TypeScript、构建和直接定向spec通过
- [x] Stage 3：一次独立subagent review完成且发现已处理
- [ ] Stage 4：验收矩阵P0全部有证据（隔离/身份/界面/任务链已完成；Nano/Suno结果提交P0失败）
- [x] Stage 4：至少两个语义独立本地commit完成
- [x] Stage 4：冻结候选后唯一一次正式安全full完成；9项旧测试夹具/可访问名称失败已最小复验转绿，未重复full
- [x] Stage 5：v0.6.29 tag/PR/merge/tree/release一致
- [x] Stage 5：冻结备份、fresh build、原子生产切换完成
- [x] Stage 6：独立云腾profile和账号凭据安全配置完成
- [x] Stage 6：三模型只在云腾下导入、发布、绑定；失败两项随后停用但未改绑/删除
- [x] Stage 6：优创前后不变证据完成
- [x] Stage 7：零付费生产门全部通过后才进入真实调用
- [x] Stage 7：最多三次有界真实smoke完成（实际3 POST；无重复创建）
- [x] Stage 8：上线后完整生产技术验收、结果下载、必要配置回滚和阻断回执完成
- [ ] Stage 8：状态停在`PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`

## 测试账本

已完成风险定向验证和唯一一次正式 full。full 退出1，`1025/1034`通过；9项失败全部是旧测试夹具或可访问名称没有跟随已验证的新隔离语义。按合同只复验失败spec：首个最小集合`30/31`，再修唯一剩余m43并`6/6`通过，未第二次运行full。不得把这组证据改写成“full全绿”。

新 Goal 每次只追加有效记录：

| 时间 | 源码 SHA | 环境 | 命令/范围 | 结果/退出码 | 为什么需要 | 是否允许重跑 |
|---|---|---|---|---|---|---|
| 2026-08-21 | `8f4a2b6`前后实现树 | Node 22.23.1 / npm 10.9.8 | TypeScript；m9/m12/m16/m18/m46/m47/m50/m56/m57/m73/m88风险定向 | review后核心有效78/78；直接相邻集合均绿 | Provider/API/UI/凭据/recovery/result commit | 已绿不重复 |
| 2026-08-21 | `8f4a2b6` + v0.6.29文档/版本树，source `c75e3520…a84c` | Node 22.23.1 / npm 10.9.8 | m38 + m81 | 56/56，退出0 | 当前状态与package一致；0.6.29 final runtime allowlist | 已绿不重复 |
| 2026-08-21 | HEAD `0f23b19`；source/snapshot `40da52cc…20a` | Node 22.23.1 / npm 10.9.8；隔离safe runner | `node scripts/run-safe-tests.mjs full`，119 specs / 1034 tests | 1025通过、9失败，退出1；快照和4173 listener不变 | 唯一正式发布full；失败为旧fixture/ARIA按钮名称 | 已消费，禁止重复 |
| 2026-08-21 | full后测试兼容树 | 同上 | m15/m2-image/m43/m44/m58最小失败集合 | 30/31，退出1；只剩m43旧导入按钮名称 | 只复验full失败spec | 不重复已绿项 |
| 2026-08-21 | 最终测试兼容树，提交`19ec414` | 同上 | m43单spec | 6/6，退出0；source/snapshot `12b428e2…83ed`，4173 listener不变 | 复验唯一剩余失败项 | 已绿不重复 |
| 2026-08-21 | 生产阻断回执树，source/snapshot `c9560566…0bf2` | Node 22.23.1 / npm 10.9.8；隔离safe runner | m38 + m81 | 56/56，退出0；4173 listener不变 | 当前状态、版本、发布治理和生产阻断回执一致 | 已绿不重复 |
| 2026-08-21 | 安全入口可见性回执树，source/snapshot `23da186a…2d4f` | Node 22.23.1 / npm 10.9.8；隔离safe runner | m38 | 15/15，退出0；4173 listener不变 | 准确记录标准表单不显示未发布云腾profile | 已绿不重复 |
| 2026-08-21 | 最终真实验收回执树，source/snapshot `ca60590b…235a` | Node 22.23.1 / npm 10.9.8；隔离safe runner | m38 | 15/15，退出0；4173 listener不变 | 文档单一事实源、版本与最终部分配置回滚回执一致 | 已绿不重复 |

## Review 账本

独立 review 预算已消费一次。发现4项：owner凭据回退全局key、relay恢复上下文未按profile隔离、result/retry/resume未完整核对attempt profile、既有model可原地跨profile重绑。主agent已全部修复并完成m12/m56/m57/m73/m88最小复验；不得再启动第二次独立review。

## 真实调用账本

创建 POST 总预算：最多3次，且只在全部零付费门通过后执行。

| 模型 | 上限 | 实际POST | task/attempt/providerTaskId | 结果 |
|---|---:|---:|---|---|
| Nano 1K文字图 | 1 | 1 | task `5f24c680…b771` / attempt 664 / `112083470` | 云腾已出图；Unboundry FORMAT失败；模型已停用，JPG已下载 |
| Kling 5秒standard | 1 | 1 | task `a7440bce…d10b` / attempt 665 / `112086188` | PASS；MP4/OSS ready，3378176字节，5.042秒 |
| Suno instrumental | 1 | 1 | task `4cdd6e1f…127a` / attempt 666 / `112087930` | 云腾已出音频；Unboundry FORMAT失败；模型已停用，MP3已下载 |

创建POST总数恰好3，三条provider attempt均只有execution_attempt=1和initial admission。Nano/Suno各发生一次基于既有providerTaskId的结果核对，没有新增POST、attempt或admission；不得再核对/重试/生成。云腾个人中心权威显示本日图片1、视频1、音频1，消耗算力4.09、余额7.14。

未知结果、失败或超时不得自动重试，不得切换优创或其他账号。

## 授权账本

- 用户已在当前会话以`/goal`明确启动完整合同，并授权 v0.6.29、发布、SSH、生产配置、最多3次真实POST、一次review和必要回滚；
- 当前Goal已经完成代码、定向测试、一次review、唯一一次full及其最小失败复验、GitHub、备份、fresh build、生产切换、云腾安全配置、三次真实调用、完整生产验收和必要配置回滚；
- 新 Goal 授权只在该 Goal 存续期间有效，完成或BLOCKED后立即消费，不延续到其他版本或Provider；
- 用户没有在聊天中提供云腾key；key已通过安全入口取得并保持不回显，未读取或借用优创key。

## 下一动作

本版本停止施工：Nano/Suno保持disabled、binding enabled=0；Kling保持published/enabled且非默认。现有云腾作品恢复文件保存在`/Users/mymy/Documents/unboundry/recovery/yunteng-provider-results-20260821`，生产历史task/attempt/providerTaskId和验收画布不得删除。不得再次运行full、发起Provider创建或结果重试、移动v0.6.29 tag、进入v0.6.30、借用优创key，或把两条失败模型重新发布为“通过”。未来结果解析修复必须新建独立版本与授权。
