# Unboundry 同一中转站三媒体模型接入验收矩阵

更新日期：2026-08-21

状态：`PRODUCTION_PUBLISHED / SUPERSEDED_BY_V0_6_29_30_REAL_EVIDENCE / CURRENT_V0_6_30_USER_PASS`

当前生产证据：v0.6.29 在独立云腾 Provider 下恰好创建 Nano、Kling、Suno 三个真实任务；v0.6.30 未新增 POST，只恢复既有 Nano JPEG 与 Suno 两个完整 MP3，Kling MP4 已在前版保存。三模型当前只归属云腾，优创隔离差异为0；用户已打开 v0.6.30 云腾生产验收项目并回复“通过”。本矩阵原 `AUTO_PASS/PAUSED` 行保留 v0.6.28 工程时点，当前聚合结论以 v0.6.30 回执为准。

当前自动证据：Node `22.23.1` / npm `10.9.8`；最终相关代码下 safe runner 的 TypeScript、构建、source coverage、外网门禁均通过。统一集合首次进入产品测试后为 `145/148`，仅 m53/m57 三条直接失败；定向修复后只重跑失败文件 m53+m57，`40/40` 通过，因此十个目标 spec 的最终有效结果为 `148/148`。所有执行均为新临时目录、动态 loopback、fake fetch，4173 前后身份不变。

## 1. 状态定义

- `PLANNED`：合同已冻结，未实现；
- `NOT_RUN`：已实现，当前证据未执行；
- `AUTO_PASS`：有当前树、命令、环境、退出码和零越界证据；
- `BLOCKED`：真实阻断，附最小复现和不扩 scope 说明；
- `PAUSED`：依赖单独真实凭据、付费或发布授权，不阻断本地工程；
- `NOT_APPLICABLE`：经证据证明不适用。

静态审查不能冒充 AUTO_PASS，真实 Provider smoke 不能冒充发布或 USER PASS。

## 2. 架构与所有权

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| ARCH-001 | P0 | 不新增 ProviderDriver，三模型均使用 multi-protocol-relay/media-generate | model/profile fixture + 调用链 | AUTO_PASS |
| ARCH-002 | P0 | GenerationResultCommit 由 Generation 拥有 | import/call graph + transaction测试 | AUTO_PASS |
| ARCH-003 | P0 | MediaLifecycle/MediaRegistry 的 reserve/finalize/fail/recovery/delete 不查询或更新 generation task/attempt | 反向引用检查 | AUTO_PASS |
| ARCH-004 | P0 | publication、provider attempt、task success、event仍同一事务 | 故障注入回滚测试 | AUTO_PASS |
| ARCH-005 | P1 | TaskStore↔Safety运行时循环消失 | import graph | AUTO_PASS |
| ARCH-006 | P1 | Provider adapter不获得数据库、TaskStore、Canvas、OSS实现 | 类型/import检查 | AUTO_PASS |
| ARCH-007 | P1 | 不建立新Media registry或Google原生图片双轨 | diff范围 | AUTO_PASS |

## 3. Nano Banana Pro

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| IMG-001 | P0 | model精确为 gemini-3-pro-image-preview | 请求fixture | AUTO_PASS |
| IMG-001A | P0 | relay model discovery把该精确ID分类为image且不落入Gemini text | m55正反例 | AUTO_PASS |
| IMG-002 | P0 | 比例按 aspectRatio 发送，精确10种 | 参数表测试 | AUTO_PASS |
| IMG-003 | P0 | 1k/2k/4k映射为imageSize 1K/2K/4K | 参数表测试 | AUTO_PASS |
| IMG-004 | P0 | 0–14张参考图按edge order写入images | 输入正反例 | AUTO_PASS |
| IMG-005 | P0 | 第15张、错误owner/kind/role在POST前拒绝 | fetch=0 | AUTO_PASS |
| IMG-006 | P1 | outputCount固定1且不发送多结果参数 | 请求快照 | AUTO_PASS |
| IMG-007 | P1 | 只走media-generate，不走Gemini原生接口 | 请求路径计数 | AUTO_PASS |

## 4. Kling V3 Omni

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| VID-001 | P0 | model精确为 kling-v3-omni-cankao | 请求fixture | AUTO_PASS |
| VID-002 | P0 | duration只发送字符串5/10/15 | 参数正反例 | AUTO_PASS |
| VID-003 | P0 | standard/quality映射std/pro | 参数表测试 | AUTO_PASS |
| VID-004 | P0 | 比例只允许16:9/9:16/1:1 | schema与请求测试 | AUTO_PASS |
| VID-005 | P0 | 0–7张图片参考按edge order写入images | 输入正反例 | AUTO_PASS |
| VID-006 | P0 | 视频/音频参考在POST前拒绝 | fetch=0 | AUTO_PASS |
| VID-007 | P0 | 70分钟截止从paid attempt created_at计算 | 注入时钟测试 | AUTO_PASS |
| VID-008 | P0 | 重启恢复只轮询原providerTaskId | startup/recovery POST=0 | AUTO_PASS |
| VID-009 | P1 | 轮询5秒起、有界到10秒，不真实等待 | fake timer/注入wait | AUTO_PASS |

## 5. Suno V4.5

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| AUD-001 | P0 | model精确为 suno-v4.5，mv固定chirp-v4-5 | 请求fixture | AUTO_PASS |
| AUD-002 | P0 | instrumental/prompt-song/lyrics-song映射正确 | 参数表测试 | AUTO_PASS |
| AUD-003 | P0 | vocalGender映射auto/m/f | 参数表测试 | AUTO_PASS |
| AUD-004 | P1 | sampleRate只允许44100/48000 | schema正反例 | AUTO_PASS |
| AUD-005 | P1 | bitrate只允许128000/192000/256000 | schema正反例 | AUTO_PASS |
| AUD-006 | P0 | lyrics-song缺歌词、空prompt+空lyrics在POST前拒绝 | fetch=0 | AUTO_PASS |
| AUD-007 | P0 | 不接受媒体参考边 | 输入反例 | AUTO_PASS |
| AUD-008 | P0 | 15分钟截止后保留taskId且不自动新POST | 注入时钟/POST计数 | AUTO_PASS |

## 6. 异步付费安全

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| ASYNC-001 | P0 | POST前先记录provider-boundary attempt | 顺序断言 | AUTO_PASS |
| ASYNC-002 | P0 | data.task_id在首次poll前绑定task和attempt | transaction顺序断言 | AUTO_PASS |
| ASYNC-003 | P0 | 提交响应丢失不直接二次POST | outcome-unknown fixture | AUTO_PASS |
| ASYNC-003A | P0 | Suno丢响应无唯一usage匹配时保持outcome_unknown且POST=0 | audio专用恢复fixture | AUTO_PASS |
| ASYNC-004 | P0 | 已有providerTaskId的reconcile/restart POST=0 | 请求计数 | AUTO_PASS |
| ASYNC-005 | P0 | 截止时间不因重启刷新 | created_at + fake clock | AUTO_PASS |
| ASYNC-006 | P0 | status地址只在404/405回退 | 404/405与401/429反例 | AUTO_PASS |
| ASYNC-007 | P0 | 无refunded=true不自动付费重试 | failed response fixture | AUTO_PASS |
| ASYNC-008 | P0 | 无取消API时不声称远端取消/退款 | cancel状态/文案断言 | AUTO_PASS |
| ASYNC-009 | P1 | 迟到成功结果只写入原task/owner/model/attempt | ownership反例 | AUTO_PASS |
| ASYNC-010 | P1 | Provider cost单位未知时不覆盖可信本地成本 | cost fixture | AUTO_PASS |

## 7. Media结果提交

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| MEDIA-001 | P0 | 下载/落盘完成前task不成功 | 故障注入 | AUTO_PASS |
| MEDIA-002 | P0 | publication失败时task/attempt/event全部回滚 | SQLite回滚测试 | AUTO_PASS |
| MEDIA-003 | P0 | task ownership失配时publication不发布 | owner/kind/attempt反例 | AUTO_PASS |
| MEDIA-004 | P0 | 重复finalize幂等且不重复历史记录 | 重放测试 | AUTO_PASS |
| MEDIA-005 | P1 | 非generation upload/playlist不依赖Generation | import与既有回归 | AUTO_PASS |
| MEDIA-006 | P1 | Provider清理失败不把成功结果改成失败 | cleanup fault test | AUTO_PASS |

## 8. 回归与安全

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| REG-001 | P0 | TypeScript noEmit通过 | Node22/npm10，退出0 | AUTO_PASS |
| REG-002 | P0 | m5 TaskStore直接回归通过 | safe runner | AUTO_PASS |
| REG-003 | P0 | m14 Safety直接回归通过 | safe runner | AUTO_PASS |
| REG-004 | P0 | m38 runtime incident/recovery通过 | safe runner | AUTO_PASS |
| REG-005 | P0 | m40幂等与恢复通过 | safe runner | AUTO_PASS |
| REG-006 | P0 | m53 relay adapter通过 | safe runner | AUTO_PASS |
| REG-007 | P0 | m54 Provider结果媒体通过 | safe runner | AUTO_PASS |
| REG-008 | P0 | m55 relay model/protocol分类通过 | safe runner | AUTO_PASS |
| REG-009 | P0 | m57 relay runtime通过 | safe runner | AUTO_PASS |
| REG-010 | P0 | m88 publication通过 | safe runner | AUTO_PASS |
| REG-011 | P1 | storage签名变化时追加直接受影响存储spec | 风险传播说明 | NOT_APPLICABLE：生成保存新token由m54/m88直接覆盖，底层存储合同未改变 |
| SAFE-001 | P0 | 自动测试真实Provider/OSS/非loopback请求为0 | runner审计 | AUTO_PASS |
| SAFE-002 | P0 | 新临时数据目录、动态loopback、4173不变 | 前后快照 | AUTO_PASS |
| SAFE-003 | P0 | app/data、/var/lib/unboundry、真实媒体/密钥未读 | 路径/环境审计 | AUTO_PASS |
| SAFE-004 | P0 | 受保护JSON未读、未改、未进snapshot/commit | status + staged清单 | AUTO_PASS |
| SAFE-005 | P1 | 未修改Canvas/Workflow/Templates/Auth/schema/version/release | diff allowlist | AUTO_PASS |

## 9. 真实验证、发布与用户验收

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| REAL-IMG-001 | P1 | 1次1K文字出图 | 专用凭据、POST次数1、结果保存 | SUPERSEDED：v0.6.29真实创建，v0.6.30零POST恢复JPEG并保存PNG |
| REAL-VID-001 | P1 | 1次5秒std文字视频 | 专用凭据、POST次数1、结果保存 | SUPERSEDED：v0.6.29真实Kling任务与MP4保存通过 |
| REAL-AUD-001 | P1 | 1次纯音乐 | 专用凭据、POST次数1、结果保存 | SUPERSEDED：v0.6.29真实创建，v0.6.30零POST恢复两个完整MP3；不把候选类型扩写成未证明语义 |
| RELEASE-001 | P0 | 版本号由用户明确指定 | 当前授权 | PASS：用户指定v0.6.28，授权已消费 |
| RELEASE-002 | P0 | push/PR/tag/发布单独明确授权 | 当前授权 | PASS：tag v0.6.28、PR #58、生产切换完成 |
| USER-001 | P1 | 用户真实页面确认三节点可选且完成 | 用户回复 | SUPERSEDED/PARTIAL：用户已通过v0.6.30云腾生产验收项目；该回执直接记录Nano图片与Suno双音频页面证据，原v0.6.28“三节点逐项可选且完成”合同未独立重跑，不冒充该精确旧条目PASS |

本地工程完成不要求 REAL/RELEASE/USER 项变为通过，也不得把 AUTO_PASS 冒充这些状态。

## 10. v0.6.28 本地 Goal 完成闸门（历史）

当时本地 Goal 完成必须：

1. 所有 ARCH/MODEL/ASYNC/MEDIA 的 P0 为 AUTO_PASS；
2. P1 未完成项有不阻断证明；
3. REG 最小集合通过，且没有为了放心重复执行；
4. 没有真实Provider、OSS、生产、4173或真实数据副作用；
5. 文档与Checkpoint同步；
6. 两个本地commit范围独立且不含受保护JSON；
7. 当时状态只写 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`；后续生产状态由对应 release receipt 追加，不反写原自动证据。

## 11. 当前执行回执

- 统一命令：Goal冻结的 m5/m14/m38/m40/m44/m53/m54/m55/m57/m88 safe-runner 命令；Node `22.23.1` / npm `10.9.8`。
- 前四次启动分别在产品spec前被 TypeScript（4处、2处）、测试清单 `1030→1034`、source-coverage manifest 闸门阻止；均按报错修正，没有产品测试重复成功记录。
- 第一次真正执行十个目标spec：退出1，`145/148`；通过数分别为 m5 21、m14 4、m38 15、m40 14、m44 8、m53 23/24、m54 9、m55 2、m57 14/16、m88 35。三处失败均为本Goal直接回归，已修正。
- 最小重跑：同一safe runner只选 m53+m57，退出0，`40/40`（m53 `24/24`、m57 `16/16`）。最终相关代码下 TypeScript、构建、source coverage、外网门禁也再次通过。
- 最终有效定向结果：十个spec `148/148`。未运行full：改动只传播到Generation/Media提交边界与relay媒体合同，冻结集合已覆盖直接TaskStore、Safety、runtime、幂等、profile lease、adapter、结果媒体、分类与publication；没有Canvas/Workflow/schema/release变化。
- 隔离：`credentialKeys=0`、`successfulRealPathOperations=0`，只使用新临时目录、动态loopback与fake fetch；4173 listener hash前后均为`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`。
- `REAL_PROVIDER_SMOKE_PAUSED`：没有专用smoke凭据与独立开关，不执行创建POST；真实Provider、OSS、SSH、生产、真实数据和发布均未触碰。
