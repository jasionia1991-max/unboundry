# Unboundry 当前权威状态

更新日期：2026-08-21
用途：新会话、压缩恢复、换人接手时先读这份。历史细节仍以各 INC 记录和 receipt 为准，**不得改写历史时点字段**。
当前代码包版本：**v0.6.27**

## 一句话

线上是 **v0.6.27 / schema39**（画布、工作流执行与任务恢复已解耦），2026-08-21 已发布；agent 已在新建真实项目中让两个不相交文字工作组于557ms内先后启动、同时保持active并全部完成，刷新后四个结果仍在原节点；用户已于同日明确验收通过。v0.6.26 为上一版。用户要的核心结果仍是：**上传一张图，工作流自己跑完，用户下载结果**。

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

## v0.6.25 发布与真实验证（2026-08-20）

- 当前代码包与线上版本均为 **v0.6.27**；v0.6.26 状态 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`并作为上一版保留。v0.6.25 的完整实施记录见 `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`，生产凭证见 `spec/V0_6_25_PRODUCTION_RECEIPT_2026-08-20.json`。
- 事二「生成任务一直排队中」已在线闭环：已知任务 `c479826f-a426-4a11-854c-79ecc802bcbc` 从 `queued / attempt 1 / provider_task_id null` 在 v0.6.25 重启后自动接力，平台任务 `111092189` 完成，最终 `success / attempt 2`；没有盲目重复。
- 事一已查清：2026-08-19 15:23–15:26Z 上游“服装主体标准化”图片成功并产出 11,596,744 字节 PNG；v0.6.23 的 10MB 文字输入预检随后拦下四个下游文字节点，五个后代未运行。不是客户端 DAG 漏发；红字把失败错归因给已经成功的上游图片节点。
- “2:33 三张主图从未提交”的旧说法已被生产任务表与 nginx 202 提交记录否定：该轮 7 图 + 4 文全部 success。
- Ark Files 已补齐失败/取消清理、底层 abort、单次与整体 poll deadline、读取前限流、OSS 流式 20MiB 上限、账号隔离 gate、脱敏结构化日志与安全本地读取。事故画布原节点 `text-932053d1…` 真实引用 `11,596,744` 字节 PNG；agent 在页面点一次生成，任务 `6d304853…` attempt 1 success、4289 tokens、结果 1278 字符；日志 upload/poll(1 次)/delete 全 success，页面显示用时 1:06 和“已保存到云端”，浏览器控制台 0 error/warn。
- Provider 成片保存退避、整组“停止后续”、持久失败摘要、scope 隔离、旧轮次保护、预检双击保护与并行失败映射均已上线。正式安全全量 `119/119 specs、1018/1018 tests PASS`，异常计数 0，最终 v0.6.25 source/snapshot SHA-256 均为 `fa9fa1dbdae1e70dd1c3c308a03e01a68cd11e6280d12682174ae8ba457525b4`；独立子 agent 终审未发现新的 P1/P2。agent 的技术实页通过不等于用户主观 `USER_PASS`。

## 线上

- 地址：https://canvas.mymy.ltd
- 指针：`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.27-canvas-execution-decoupling-20260821`
- 源码：commit `26525387ff02a34d8de1eae4d74ed51c11529a7a`，tree `3735ea655cc9f353b0ccfca1060221cea445ba0e`
- 标签：`v0.6.27` 精确指向该源码
- 功能 PR：#53，merge `4a675be056aaca4b3d3a3239136857fecbefbb94`，main tree 与 tag tree 一致
- 冻结备份：`/var/lib/unboundry-rollbacks/v0.6.26-frozen-234452`（365 文件，两份清单 SHA 同为 `6b64da90d996446e570a60bc0454ead445defe42df09579787e796e39864b525`）
- 上一不可变版：`v0.6.25-generation-hardening-20260820`（以及更早版本）仍保留
- v0.6.26切换基准：schema39、integrity ok、FK0、tasks569、attempts577、公共模板50（48 published）、active0；本轮发布前只读现场为tasks590、attempts598、公共模板50（48 published）、active0。
- 生产并发配置已恢复推荐值：per_user 20 / image 10 / video 2 / audio 2 / text 10 / RPM 120
- 正式安全全量：`119/119 specs、1025/1025 tests PASS`
- v0.6.25 已于 2026-08-20 发布，agent 真实页面与最小真实 Provider 验证通过，待用户主观复验；更早用户已通过版本状态保持不变

## 最新发布（2026-08-20 已发布，agent 技术实页通过，待用户主观复验）

**v0.6.25（生成恢复与整组运行加固）**：旧执行挡住自动重试时，退场后可靠接力；Ark Files 完整清理/abort/限流/gate/结构化日志；保存退避完整；整组“停止后续”和失败摘要/隔离/旧轮次保护上线。正式安全全量 `119/119 specs、1018/1018 tests PASS`。生产旧 queued 任务自动接力成功；原事故节点用 11,596,744 字节 PNG 在真实页面完成一次文字生成，Ark upload/poll/delete 全 success。权威凭证：`spec/V0_6_25_PRODUCTION_RECEIPT_2026-08-20.json`。

**v0.6.24（方舟文字模型大图原图直传 Files API，INC-GEN-011）**：火山方舟文字模型引用 10–20MB PNG 参考图时，不再被 10MB 限制拦下、也不再压缩转 Base64，而是原图直传：上传到方舟临时文件后用 file_id 发给文字模型。上传/轮询/删除全程在配置锁外（避免重演线上锁死）；每个优创连接同时最多 2 个大图上传、排队最长 30 秒；超时写死（上传 60s / 等待就绪 120s / 删除 10s）；上传失败不产生计费记录；取消后独立清理信号删除文件不留孤儿；代码默认关闭，但生产已显式打开（`UNBOUNDRY_ARK_FILES_API=1`，systemd drop-in），关闭时旧路径 100% 不变。v0.6.24 发布时真实方舟 12MB 验证通过；当时尚无用户侧 `ark-files-*` 记录。该缺口已由上方 v0.6.25 的 11MB 真实页面验证补齐。

权威方案：`spec/INC_GEN_011_ARK_FILES_API_2026-08-20.md`。权威凭证：`spec/V0_6_24_PRODUCTION_RECEIPT_2026-08-20.json`。

**v0.6.23（生成稳定性根治修复）**：针对 v0.6.22 上线后仍反复出现的卡住/红字问题，本轮从全局根治：1）优创固定通道的轮询、提交、恢复全部接上配置锁释放边界，发起平台请求即释放配置锁，不再长时间占用；2）保存保险丝改为有界重试（5 次退避：1s/2s/4s/8s/15s），锁忙不再被误判成「平台配置已变化」；3）服务端每 30 秒自动扫描「有平台任务号但本地未收片」的旧任务并自动 resume（只回收、绝不重新付费提交）；4）前端锁忙自动重试、画布保存最长自动等 90 秒、取消用持久化任务号兜底；5）生产并发配置从 500 恢复为推荐值（20/10/2/2/10/120），消除放大器。已随 v0.6.23 上线，2026-08-19 发布，待你打开线上页面复验。

权威凭证：`spec/V0_6_23_PRODUCTION_RECEIPT_2026-08-19.json`。

**v0.6.22（四合一生成稳定性修复，已被 v0.6.23 根治版取代）**：1）同一输入已有平台任务已受理/已出片时禁止重复付费提交，只允许先「核对结果」，避免重复扣费；2）成片保存失败按瞬时/终局分类：瞬时错误继续后台核对/轮询并保持呼吸灯，终局错误按任务原样收口，不再把「还在尝试」误判成红字；3）手动/自动重试共用同一道同输入防重判断；4）切换模型时保留已选比例与画质。已随 v0.6.22 上线，2026-08-19 发布，待你打开线上页面复验。

权威凭证：`spec/V0_6_22_PRODUCTION_RECEIPT_2026-08-19.json`。

## 模板数据变更（2026-08-19 已上线并在 v0.6.22 更新内容，待用户复验）

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
2. 只读核对仓库分支、HEAD、工作树、`package.json` 版本是否已是 `0.6.17`。
3. 优创 4K（INC-GEN-008/009）已随 v0.6.17 上线，等用户打开线上页面复验；真 4K 出图必须用户单独点头。
4. OpenRouter 出图先放下。不要再放行钥匙、不要真去 OpenRouter 出图。
5. 若用户说「还是假提交 / 工作流又停了」，先查线上任务和分类，再给方案，等他下令再改。
6. 旧的两条假提交记录（服装格 `88c8e891`、`10324851`）若还在，同一套输入可能要先点一次「核对结果」才能再开新单。不要擅自改生产库去解锁。
