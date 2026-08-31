# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`）。

**当前版本、未发布工作区、待验收项和下一步只以 [`spec/UNBOUNDRY_CURRENT_STATE.md`](spec/UNBOUNDRY_CURRENT_STATE.md) 为准。** 本 README 下方是按日期保留的历史变更账本，不承担“当前线上版本”播报，旧段落中的版本与状态只代表各自记录时点。

干活和上线怎么拍板，看 [`上线规矩.md`](上线规矩.md)。没分别确认版本号和允许发布，不能推、不能上线。

## 当前候选：v0.6.65 / INC-GEN-019（R8发布中，USER RECHECK）

INC-GEN-019已完成共享30秒单调deadline、成功preflight revision精确校验、同key有界收敛和formal unknown原key核对；业务产品+测试10/10，独立Review为`P0=0/P1=0/P2=0/GO`。唯一formal full原始`1133/1135`及2失败永久保留，最小关闭`62/62`；版本直接safe m81+m38=`57/57 PASS`，未重跑full。v0.6.65尚未发布，生产仍为v0.6.64/schema41；GitHub、生产零付费门和目标group真实流仍待R8执行，真实点击前必须证明总费用不超过CNY100等值。权威断点见[`spec/INC_GEN_019_CHECKPOINT.md`](spec/INC_GEN_019_CHECKPOINT.md)。

## 当前线上：v0.6.64 / INC-GEN-018生产技术通过（2026-08-31，USER RECHECK）

INC-GEN-018已把平台全局安全状态与单模型合同健康拆开，并只为Doubao Seed与Doubao TTS 2.0的两个精确旧immutable revision发布replacement revision。R0～R8技术门完成；冻结候选独立终审保持`P0=0/P1=0/P2=7/GO`，唯一正式safe full原始`1131/1135`及4失败永久保留，4项均已定向关闭且隔离浏览器AUTO_PASS。PR #134 final-head/main CI、v0.6.64不可移动tag/Release、fresh build、冻结恢复、生产迁移、repeat no-op、原子切换和paired rollback/forward均通过。生产10/10 published模型健康，目标7节点零付费preflight不再出现伪`GLOBAL_GENERATION_DISABLED`；tasks1026/attempts1037/active0不变，Provider POST、OSS写和新费用均为0。当前严格为`PRODUCTION_V0_6_64_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`，不能冒充`USER_PASS`。生产回执见[`spec/V0_6_64_PRODUCTION_RECEIPT_2026-08-31.json`](spec/V0_6_64_PRODUCTION_RECEIPT_2026-08-31.json)。

权威入口：[`Checkpoint`](spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_CHECKPOINT.md) → [`Plan`](spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_PLAN_2026-08-30.md) → [`Matrix`](spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-30.md) → [`一次性Goal`](spec/INC_GEN_018_ONE_SHOT_GOAL_PROMPT_2026-08-31.md)。当前断点只以Checkpoint为准；技术通过不等于用户实页通过。

## 历史线上：v0.6.56 数字task ID真实闭环（2026-08-28，USER RECHECK）

v0.6.56已完成PR #124/main CI、不可移动tag/GitHub Release、fresh build、冻结备份恢复、原子发布、回滚和生产健康门。目标Canvas唯一真实GK提交成功：数字task ID `118533110`已持久化，MP4自动回填并经刷新保持；实际费用USD10、unknown-billing 0。当前严格为`PRODUCTION_V0_6_56_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK`，只有用户看完成片明确确认后才可升级`USER_PASS`。回执见[`spec/V0_6_56_PRODUCTION_RECEIPT_2026-08-28.json`](spec/V0_6_56_PRODUCTION_RECEIPT_2026-08-28.json)。

## 历史线上：v0.6.47 治理与默认 Node 25（2026-08-26，USER PASS）

生产已运行`v0.6.47 / schema41`，服务active/enabled、NRestarts=0，回环与公网version/live/ready、冻结备份恢复、release inventory和5个静态资源逐字节校验全部通过。PR #110、PR/main Quality CI、不可移动tag与GitHub Release已完成；真实Provider、Generation、OSS写入与费用为0。用户随后明确回复`v0.6.47 验收通过`，当前为`PRODUCTION_V0_6_47_USER_PASS / USER_PASS`。原技术回执见[`spec/V0_6_47_PRODUCTION_RECEIPT_2026-08-26.json`](spec/V0_6_47_PRODUCTION_RECEIPT_2026-08-26.json)，保留其生成时状态。

项目普通shell、开发和CI默认工具链现为Node `25.9.0` / npm `11.12.1`；生产运行时仍为Node `22.23.2` / npm `10.9.8`，安全/发布复现通道使用Node `22.23.1` / npm `10.9.8`。本版发布了项目默认与双通道合同，没有迁移生产Node运行时。

MODEL-CONTRACT-001模型执行合同治理见[`spec/MODEL_CONTRACT_001_MODEL_EXECUTION_CONTRACT_GOVERNANCE_PLAN_2026-08-26.md`](spec/MODEL_CONTRACT_001_MODEL_EXECUTION_CONTRACT_GOVERNANCE_PLAN_2026-08-26.md)。v0.6.48/schema41已完成R0-R7、GK-video-3精确请求合同、独立管理工作台和GitHub发布；正式恢复副本bootstrap因审计actor外键在生产切换前fail-closed，现网仍为健康v0.6.47。v0.6.49 hotfix定向48/48、恢复副本首次11/11与二次0新增、独立Review GO均通过，下一步GitHub与生产重试；唯一full未重复，成片视觉仍为`USER_RECHECK`。

## 历史线上：v0.6.43 节点排序菜单层级修复（2026-08-25，USER RECHECK）

INC-UI-011只把组合框「宫格 / 水平」菜单Portal到页面顶层，补齐视口避让、手势隔离、Escape返焦和零保存副作用，没有改变排序算法、schema或Provider合同。用户已在本地密集组合框页明确`USER_PASS`；唯一safe full `121/121 specs、1061/1061 tests PASS`。PR #100、PR/main CI、不可移动tag/Release、schema41恢复演练、fresh原子发布和生产零付费浏览器均通过；生产菜单中心点命中自身，打开/关闭前后画布revision不变。真实Provider、Generation、OSS写入和费用均0。当前状态`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`，回执见[`spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json`](spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json)。

## 上一线上事件：v0.6.42 整组刷新恢复与组合框拖动性能（2026-08-25，USER RECHECK）

INC-GEN-013已把group run checkpoint升级为accepted-task精确绑定，并把组合框切回React Flow统一拖动路径。PR #98、CI、tag/Release、schema41恢复副本、fresh原子发布及三视口零付费浏览器均通过；当前保持`PRODUCTION_V0_6_42_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`历史状态，回执见[`spec/V0_6_42_PRODUCTION_RECEIPT_2026-08-25.json`](spec/V0_6_42_PRODUCTION_RECEIPT_2026-08-25.json)。

## 更早线上事件：v0.6.41 角色风险预检关闭态（2026-08-25，USER RECHECK）

INC-SEEDANCE-002已按正式合同核验自动选择C分支：第三方审核票据没有Seedance正式提交字段，虚拟人像权益订阅超预算，公开审核Provider合同也不足以完成A的分类与隐私证明。v0.6.41把产品准确命名为「角色风险预检」并在菜单层禁用入口，同时保留独立的「角色可信素材」入口；不显示蓝勾，不声称Seedance验证、版权认证或法律合规。独立终审无剩余P0/P1；唯一safe full `121/121 specs、1061/1061 tests PASS`。PR #96、CI、tag/Release、schema41迁移、fresh原子发布与三视口零付费浏览器均通过；真实审核、Generation、OSS、订阅/购买和费用均0。当前状态`PRODUCTION_V0_6_41_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`，回执见[`spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json`](spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json)。

## 当前事件：v0.6.40 已技术发布（2026-08-25，真实链受外部订阅阻断）

生产当前运行`v0.6.40 / schema40`且技术健康；PR #92、Quality CI、tag、GitHub Release、冻结备份、fresh build、原子切换、公网/回环、数据不变和5资源门均通过。受限Provider诊断只保留HTTP状态、错误码和RequestId，不保留远端Message、Body或密钥，并把创建/查询失败写入既有状态字段。Project `default`已只为目标IAM用户补`ArkFullAccess`，用户详情明确显示项目限制；一次误加的用户级策略被立即撤销且无残留。随后唯一H5创建`1/1`返回远端`403 SubscriptionRequired`，无Provider session ID、H5Link或BytedToken；认证查询、Asset创建/查询、Generation与OSS均0。当前为`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_APPLIED / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / BLOCKED_EXTERNAL_CAPABILITY / USER_RECHECK`，本事件不购买、不重试。回执见[`spec/V0_6_40_PRODUCTION_RECEIPT_2026-08-24.json`](spec/V0_6_40_PRODUCTION_RECEIPT_2026-08-24.json)；v0.6.39历史回执和v0.6.38既有`USER_PASS`均保持不变。

## 上一用户验收：v0.6.38 已获用户通过，真实协议仍为fail-closed

INC-IMGEDIT-005已完成全部17个入口、三视口、四zoom、透明/横竖方图、本地与模型语义、Seedance分层和空白区放置复审；独立审查最终无P0/P1/P2，safe m100+m2 `24/24 PASS`。唯一一次safe full原始`1052/1053`，唯一失败为旧治理正则；精确修正后m38 `15/15 PASS`，未运行第二次full。生产浏览器代表序列写请求0、Generation/Provider0、console error/warn0，数据不变。权威回执为[`spec/V0_6_37_PRODUCTION_RECEIPT_2026-08-24.json`](spec/V0_6_37_PRODUCTION_RECEIPT_2026-08-24.json)；只有用户在生产实页明确回复“通过”后才升级`USER_PASS`。

## v0.6.32 图片裁剪同站编辑源

OSS 图片裁剪改为通过 owner-scoped 同站接口读取并校验原图，客户端只把同源 Blob 画入 Canvas，避免跨域重定向污染画布；解析器保持可替换，后续可接独立媒体域名。v0.6.32 已上线并获用户实页确认。裁剪准备态的缩略图/紧凑加载体验已按 [`spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md`](spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md) 随v0.6.33上线；HTTP/OSS图片使用320×180小型加载卡片以避免重复下载，只有`blob:`/`data:`内存预览才显示缩略图。生产技术门和用户线上复验均已通过。

## 2026-08-19 生成稳定性一次性修复（v0.6.20 已发布，待你复验）

`INC-GEN-010 = PRODUCTION_PUBLISHED_AUTO_PASS（2026-08-19 已发布，待用户复验）`：生成流程少红字、少手动操作。图片主轮询 5 分钟、视频 8 分钟，主窗结束后后台继续慢速核对；任务号丢失自动从用量记录找回，确认缺失时整个任务只自动补提交一次；平台明确退款自动确认并重试一次；只有明确拒绝/本地问题才红字；结果下载网络/5xx 自动重试 3 次；熔断按账号拆分；画布保存等待放宽到 15 秒、按钮显示「正在保存画布…」。正式安全全量`118/118 specs、983/983 tests PASS`，异常0。生产已切到`v0.6.20-inc-gen-010-20260819`，冻结备份、schema39 和数据门通过；tasks358/attempts364/active0、模板48（46 published），真实 Provider/付费/OSS 写入 0。`v0.6.20` 标签指向精确生产源码，PR #35 已合并。方案见 [`spec/INC_GEN_010_GENERATION_STABILITY_2026-08-19.md`](spec/INC_GEN_010_GENERATION_STABILITY_2026-08-19.md)，凭证 [`spec/V0_6_20_PRODUCTION_RECEIPT_2026-08-19.json`](spec/V0_6_20_PRODUCTION_RECEIPT_2026-08-19.json)。

## 2026-08-19 优创尺寸映射面板 UI 对齐（v0.6.18 已发布并通过你复验）

管理员后台「优创尺寸映射」面板样式已对齐项目暗黑 UI：按钮/输入框/表格统一，比例输入支持下拉建议，说明文案改成人话（空着就按内置表出图）。出图逻辑不变。正式安全全量`118/118 specs、983/983 tests PASS`。生产已切到`v0.6.18-ui-align-20260819`，冻结备份、schema39 和数据门通过；tasks322/attempts326/active0、模板48（46 published），真实 Provider/付费/OSS 写入 0。`v0.6.18` 标签指向精确生产源码，PR #32 已合并。v0.6.17 也已通过你复验。2026-08-19 你回复「通过」，v0.6.19 为本次收口发布。凭证 [`spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json`](spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json)。

## 2026-08-19 优创按文档尺寸出图 + 后台自改尺寸表（v0.6.17 已发布并通过你复验）

`INC-GEN-008 + INC-GEN-009 = PRODUCTION_PUBLISHED_USER_PASS（2026-08-19 你回复「通过」）`：优创专用协议选 1K/2K/4K 时按文档像素真发 `size`，不再偷换成 1024×1536；默认画质已改为 1K；管理员后台可自改「画质档 × 比例 → 像素」映射，只影响优创 gpt-image。正式安全全量`118/118 specs、983/983 tests PASS`。生产已切到`v0.6.17-inc-gen-008-009-20260819`，冻结备份、schema39 和数据门通过；tasks322/attempts326/active0、模板48（46 published），真实 Provider/付费/OSS 写入 0。`v0.6.17` 标签指向精确生产源码，PR #31 已合并。2026-08-19 你回复「通过」。方案见 [`spec/INC_GEN_008_YOUCHOANG_GPT_IMAGE_SIZE_2026-08-18.md`](spec/INC_GEN_008_YOUCHOANG_GPT_IMAGE_SIZE_2026-08-18.md) 与 [`spec/INC_GEN_009_ADMIN_EDITABLE_GPT_IMAGE_SIZE_MAP_2026-08-19.md`](spec/INC_GEN_009_ADMIN_EDITABLE_GPT_IMAGE_SIZE_MAP_2026-08-19.md)。

## 2026-08-18 管理员可从画布组直接发公共模板（v0.6.16 已发布并通过用户验收）

`INC-UI-010 = PRODUCTION_PUBLISHED_USER_PASS`：管理员在画布上打组、点「创建模板」，可选发到公共模板；默认仍是我的模板。发公共时清掉私图，留下提示词、节点和连线。普通账号看不到该选项。正式安全全量`118/118 specs、979/979 tests PASS`，异常0。生产已切到`v0.6.16-inc-ui-010-20260818`。用户随后明确回复“通过”。当前权威快照见 [`spec/UNBOUNDRY_CURRENT_STATE.md`](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 2026-08-18 假提交不再挡住工作流（v0.6.15 已发布并通过用户验收）

`INC-GEN-007 = PRODUCTION_PUBLISHED_USER_PASS`：GPT Image 不到 1 秒的失败不再谎称已提交；整组会自己核对或再试一次并继续。正式安全全量`118/118 specs、976/976 tests PASS`，异常0。生产已切到`v0.6.15-inc-gen-007-20260818`。用户随后明确回复“通过”，验收正式收口。当前权威快照见 [`spec/UNBOUNDRY_CURRENT_STATE.md`](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 2026-08-18 过期「画布还在保存」不再挡整组（v0.6.14 已发布并通过用户验收）

`INC-GEN-006 = PRODUCTION_PUBLISHED_USER_PASS`：整组开跑前不再把上次的「画布还在保存」当成不兼容；开跑后清掉组里这类过期红字。模型不对、缺图、连线不对照样拦。正式安全全量`118/118 specs、973/973 tests PASS`，异常0。生产已切到`v0.6.14-inc-gen-006-20260818`，冻结备份恢复、公网三份关键资源、schema39和数据门均通过；tasks294/attempts296/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.14`标签指向精确生产源码，PR #24已合并。用户于 2026-08-18 明确回复「全通过」，验收正式收口。

## 2026-08-18 解开 Seedance Mini 时长/清晰度锁（v0.6.13 已发布并通过用户验收）

`INC-GEN-005 = PRODUCTION_PUBLISHED_USER_PASS`：Seedance 2.0 Mini 的 4～15 秒和 480p/720p 不再被「付费验证」禁用；默认仍是 5 秒/480p。模型参数保存失败不再假装成功。正式安全全量`118/118 specs、971/971 tests PASS`，异常0。生产已切到`v0.6.13-inc-gen-005-20260818`。用户随后明确回复“通过”，验收正式收口。

## 2026-08-18 整组节点结束后先存稳（v0.6.12 已发布并通过用户验收）

`INC-GEN-004 = PRODUCTION_PUBLISHED_USER_PASS`：整组每个节点跑完后先把结果存进服务器，再让下游开工；等版本号时再确认画布没有又在存；整组遇到「画布还在保存」最多再试一次。错误提示留约 8 秒。不改服务器 409、不改多标签最后保存者胜、不改同层并发生成。正式安全全量`118/118 specs、971/971 tests PASS`，异常0。生产已切到`v0.6.12-inc-gen-004-20260818`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks256/attempts258/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.12`标签指向精确生产源码，PR #21已合并。用户于 2026-08-18 明确回复「全通过」，验收正式收口。

## 2026-08-17 整组下载改走数据盘（v0.6.11 已发布并通过用户验收）

`INC-UI-009 = PRODUCTION_PUBLISHED_USER_PASS`：整组/模板打包不再去小内存盘借空间，改走数据盘；盘上只用中性临时文件名；1GB 保底和原有上限不降。正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.11-inc-ui-009-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks246/attempts248/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.11`标签指向精确生产源码，PR #18已合并。用户随后明确回复“通过”，验收正式收口。

## 2026-08-17 文字节点画布级全屏（v0.6.10 已发布并通过用户验收）

`INC-UI-008 = PRODUCTION_PUBLISHED_USER_PASS`：文字点「全屏」不再进系统全屏，改为和图片一样的画布遮罩；中间只读正文可滚动，按钮为「复制」。正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.10-inc-ui-008-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks246/attempts248/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.10`标签指向精确生产源码，PR #16已合并。用户于 2026-08-18 明确回复文字全屏也通过，验收正式收口。

## 2026-08-17 失败生成自动核对（v0.6.9 已发布并通过用户验收）

`INC-GEN-003 = PRODUCTION_PUBLISHED_USER_PASS`：失败后系统自己去平台用量明细里配对，对得上就收回成片，对不上就停住；用户不再填平台任务号。GPT Image 收回不新开付费请求。正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.9-inc-gen-003-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks237/attempts239/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.9`标签指向精确生产源码，PR #12已合并。用户随后明确回复“通过”，验收正式收口。

## 2026-08-17 同层生成提交排队（v0.6.8 已发布并通过用户验收）

`INC-GEN-002 = PRODUCTION_PUBLISHED_USER_PASS`：同一组同层节点一起跑时，先把「等保存 → 提交任务 → 写回任务号」按画布排队，平台出图/出字/出视频仍同时进行，避免互相报「画布还在保存」。上线规矩页入库。正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.8-inc-gen-002-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks230/attempts232/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.8`标签指向精确生产源码，PR #10已合并。用户随后明确回复“看了 也通过了”，验收正式收口。

## 2026-08-17 生成用时与画布核对结果（v0.6.7 已发布并通过用户验收）

`INC-GEN-001 = PRODUCTION_PUBLISHED_USER_PASS`：选中节点、组和任务面板会显示这次生成用了多久，不写进画布。平台结果对不上时，在画布上点「核对结果」就能查回成片或确认没有成片后再重试，不用自己去平台下图。普通失败仍可直接重试。正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.7-inc-gen-001-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks220/attempts221/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.7`标签指向精确生产源码，PR #8已合并。用户随后明确回复“看了 也通过了”，验收正式收口。

## 2026-08-17 组标题、文字节点平移与模板目录刷新（v0.6.6 已发布并通过用户验收）

`INC-UI-007 = PRODUCTION_PUBLISHED_USER_PASS`：Group标题回到距主体约8px并支持最长40字符完整换行，不增加组内边距/边框、不移动任何节点；Text阅读态把滚轮和中键拖动交还画布，双击编辑后仍由正文持有；公共模板目录每次打开及BFCache返回都以`no-store`读取服务端，后台改名无需硬刷新。最终定向`17/17`、正式安全全量`118/118 specs、969/969 tests PASS`，异常0。生产已切到`v0.6.6-inc-ui-007-20260817`，冻结备份恢复、公网三份关键资源、schema39和数据不变门均通过；tasks153/attempts152/active0、模板47/46不变，真实Provider/付费/OSS写入0。`v0.6.6`标签指向精确生产源码，PR #6已合并到`main`；用户随后对本轮三项修复明确回复“通过”，验收正式收口。

## 2026-08-16 缩放时节点/模板坐标漂移（v0.6.5 已发布并通过用户验收）

`INC-UI-006 = PRODUCTION_PUBLISHED_USER_PASS`：Group标题/工具栏反向缩放已移出React视口订阅，缩放/平移安静期拒绝被动非拖拽坐标变更，画布载入、模板应用及组模板保存统一阻断根组自引用；真实拖动、键盘移动和resize仍保留。正式安全全量`118/118 specs、968/968 tests PASS`，异常0。冻结备份后目标组恢复为无父级`(-1080,-1080)`，另一历史自引用根只移除自引用并保留原坐标；节点89、边145和viewport不变。生产已切到`v0.6.5-inc-ui-006-20260816`，公网资源、schema39、数据不变和登录实页72节点连续缩放均通过，`movedIds=[]`；真实Provider/付费/OSS请求0。`v0.6.5`标签精确指向生产源码，PR #4已合并到`main`；用户随后明确回复“通过”，本事件正式收口。

## 2026-08-16 组标题总览层级（v0.6.4 已发布并通过用户验收）

`INC-UI-005 = PRODUCTION_PUBLISHED_USER_PASS`：组标题继续保持屏幕空间可读，但与组框固定保持约20px间隔并限制到72～180px；15%总览时组内节点标题默认隐藏，鼠标进入组或选中组时仅恢复该组。没有给组增加标题栏、内边距或边框，也不移动组内节点；普通未分组节点标题保持现有行为。正式安全全量`118/118 specs、968/968 tests PASS`，异常0，真实Provider/付费/OSS请求0。生产已切到`v0.6.4-inc-ui-005-20260816-r2`；发布门在真实浏览器发现首个产物夹带旧dist后拒绝该产物并以精确源码fresh build重新发布。最终公网资源哈希、隔离启动、冻结备份恢复、active/schema39与数据不变门均通过；15%和约27%缩放实页验证间距、宽度、默认隐藏与单组披露通过。用户于 2026-08-18 明确回复「全通过」，验收正式收口。

## 2026-08-16 节点标题缩放可读性（已发布并通过用户验收）

`INC-UI-004 = PRODUCTION_PUBLISHED_USER_PASS`：普通节点标题在画布缩小时采用屏幕空间补偿，15%总览约12px、35%～100%约14px；统一提高灰白对比度、500字重和轻微暗色阴影。长标题保持单行省略与完整`title`，Group不重复补偿，Storyboard宽度单独限制；总览档未选中标题不拦截画布指针，选中标题仍可编辑。节点尺寸、位置、连线和持久数据均不改变。相关6份spec `16/16 PASS`，正式安全全量`118/118 specs、968/968 tests PASS`，异常0，生产构建通过，真实Provider/付费/OSS请求0。生产已切到`v0.6.3-inc-ui-004-20260816`；公网资源哈希、隔离启动、冻结备份恢复、active/schema39与数据不变门均通过，tasks153/attempts152/active0及模板46/45不变。用户于 2026-08-18 明确回复「全通过」，验收正式收口。

## 2026-08-16 公共模板 UI 与旧画布会话恢复（已发布并通过用户验收）

`INC-UI-003 = PRODUCTION_PUBLISHED_USER_PASS`：公共模板管理页和编辑弹窗已对齐统一灰阶UI、GrayMenuSelect、自绘复选框、主次按钮、焦点圈定及窄屏布局。特定项目返回失败的根因是浏览器单标签遗留的旧server-epoch pagehide journal；内容相同时零PUT结算，不同时保留双方内容并提供“打开服务器版本”，新标签载入权威画布且原标签恢复副本不被覆盖。正式安全全量`118/118 specs、967/967 tests PASS`；生产已切到`v0.6.3-inc-ui-003-r2-20260816`，公网0.6.3、active/schema39、NRestarts0。Chrome真实验证目标画布恢复、返回路径和弹窗UI/键盘合同通过；切换前后tasks132/attempts131/active0及模板46/45不变，真实Provider/付费/OSS写入0。用户于 2026-08-18 明确回复「全通过」，验收正式收口。

## 2026-08-16 画布 UI 恢复（已发布并通过用户验收）

`INC-UI-001/002 = PRODUCTION_PUBLISHED_USER_PASS`：设置页会返回进入前的真实项目并提供“返回工作空间”，浏览器 favicon 和页面标题已恢复；巨大 Group 只有被框选完整包含时才进入选区，普通节点仍保留局部相交框选；图片/视频/音频读取失败会保留素材并显示统一灰阶重载/重新上传状态；七类节点长标题统一省略并可查看完整值。正式安全全量为 `118/118 specs、965/965 PASS`，失败、跳过、重试、blocked 与报告错误均为 0。该UI版本先发布到`v0.6.2-inc-ui-002-20260816`，随后视频协议热修复发布到新的不可变目录`v0.6.2-inc-video-001-20260816`；schema39数据与安全配置未迁移。用户于 2026-08-18 明确回复「全通过」，相关条目正式收口。

## 2026-08-16 v0.6.2 生产状态（历史时点，已由v0.6.3替代）

- 生产指针：`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.2-inc-video-001-20260816`；服务 active+enabled，`NRestarts=0`，公网 `/api/version` 返回 `0.6.2`，ready 为 active/schema39。
- 视频热修复把Grok首帧按中转站真实契约映射为`images`数组并限制恰好1张；正式安全全量仍为`118/118 specs、965/965 PASS`。Grok契约已被中转站受理，但该上游两次在0%网络超时，因此停止重试并把默认视频模型切换为已真实成功的`Seedance 2.0 Mini`。
- 最新数据核验：schema39、quick_check `ok`、FK 违约0、active generation0、tasks126、Provider attempts125。此前`v0.6.2-inc-ui-002-20260816`完整保留，可作为回滚目标。
- 视频热修复源码commit为`959c1e287fb25943ca13037332030e99b39725be`、tree为`6539868d3aa5df8be2fdbf3d10e8c6414ffe3845`；专用分支已推送，注释标签`v0.6.2`精确指向该生产源码提交，Draft PR [#1](https://github.com/jasionia1991-max/unboundry/pull/1)已更新为完整v0.6.2范围且merge state为CLEAN。

### 真实工作流低成本验收

2026-08-16 用户明确授权真实API消耗后，在生产项目`v0.6.2 真实工作流低成本验收`完成`Text → Image`整组工作流：Text先成功，Image只在Text完成后启动；1张`1:1 / 1K`图片约92秒成功，刷新后文字、连线、Group和OSS图片均保持。随后真实视频排障确认Grok中转上游网络超时，未再继续消耗；默认视频模型改为Seedance，并以`4秒 / 480p / 无音频 / 无人物`完成一次文生视频，task`c0269665-4db5-46a1-bc13-2d5574a66cca`一次成功。结果MP4为864×496、4.042秒、1,117,495 bytes、OSS ready，刷新后可播放且浏览器媒体无错误。成功视频在应用账本记录`568316 microunits CNY`，仅作审计字段，不冒充Provider账单。公网ready仍为active/schema39，数据库quick_check ok、FK0、active0。

## 2026-08-15 整组工作流流水线修复（已发布并通过用户实页验收）

`INC-ECOM-007 = PRODUCTION_PUBLISHED_USER_PASS`：整组执行已改为事件驱动DAG流水；多直接生成式上游严格AND，分流独立推进、汇流等待全部、失败只阻塞后代，Text/Image/Video/Audio在实际提交前统一刷新runtime preflight。正式full基线`117/117 specs、959/959 PASS`，版本准入修复后相关8份spec `110/110 PASS`，精确发布HEAD build PASS，真实Provider请求0。生产已原子切换到不可变`v0.6.1`发布目录，公网version/live/ready和主JS哈希一致；schema39、quick_check ok、FK0、tasks109、attempts107、active0及并发500均前后不变。停机备份已完成恢复副本校验；用户随后在线上实页明确确认“通过通过”。

## 2026-08-15 第三批电商工作流（已发布并通过用户确认）

`INC-ECOM-006 = PRODUCTION_PUBLISHED_USER_PASS`：用户明确“确定 发布”后，第三批P0/P1/P2共12条已按声明式数据单事务导入生产；生产全库43/43兼容PASS、第三批12/12 PASS、问题0，42条published，第三批12条均有graph与实图封面，公网封面12/12 HTTP200 image/jpeg。schema39 quick_check ok/FK0、service active/enabled、NRestarts0。发布前后tasks109、Provider attempts107、active0，并发/RPM仍全部500，Provider/付费生成/OSS变化0；用户随后明确“都通过了”，可见性与视觉验收收口为PASS。

## 2026-08-15 第二批电商工作流（已发布）

`INC-ECOM-005 = PRODUCTION_PUBLISHED_USER_PASS`：用户已确认继续`v0.6.0`并允许发布，此前列出的P0/P1/P2共12条工作流已事务导入生产。当前生产兼容审计12/12 PASS、问题0，运行时目录读取30条published模板，第二批12条均有graph和实图封面；公网12/12封面HTTP200 image/jpeg。schema39 quick_check ok/FK0、service active/enabled、NRestarts0。发布前后tasks109、Provider attempts107、active0，并发/RPM仍全部500，Provider/付费生成/OSS变化0。用户随后明确第二批实页验收“通过1”；模板不是前端硬编码，默认拓扑、元提示词和模型ID作为`public_templates.graph`数据保存，应用时复制为画布的新节点。

## 2026-08-15 电商参考图修复（已发布并完成用户收口）

`INC-ECOM-002/003 = PRODUCTION_STATIC_REPAIR_PASS / ONE_REQUEST_REAL_IMAGE_SMOKE_PASS / USER_RESULT_PASS / OPTIONAL_PAID_GENERATION_DEFERRED`：参考图拆锁、错误分层、模板模型绑定与发布兼容门均已上线，目标节点`工艺拆解·完整商品`的一次1K真实图片复验成功；用户随后明确“都通过了”。该模板另外两个图片输出和其他电商视频没有再次发起付费生成，只作为可选内容抽验延期，不冒充真实生成PASS，也不阻塞v0.6.1发布。

## 2026-08-15 v0.6.1 生产收口（历史时点）

- 当前状态：`REM-000～011（含009A/009B） = PASS / PRODUCTION = LIVE / INC-ECOM-001～007已按各自边界完成用户收口`。v0.6.0既有用户验收与v0.6.1新增流水执行语义均已分别确认；未执行的付费两图/视频抽验及其余历史 `PARTIAL / PAUSED / BLOCK / NOT_STARTED` 项保持延期或原状态。
- 生产指针为 `/opt/unboundry/current -> releases/v0.6.1-inc-ecom-007-20260815`，服务 `active + enabled`、`NRestarts=0`、监听 `127.0.0.1:4173`；公网 live/ready/version/root 均正常，version 为 `0.6.1`，ready 为 active/schema39。
- 生产数据库在最新核验时为 schema39、quick_check `ok`、FK 违约 0、活动生成任务 0；共有109个任务、107条Provider attempt、43条公共模板（42 published）。安全阈值保持`globalEnabled=1 / emergencyStop=0 / per-user、RPM及四类并发均500`；本次切换前后任务与attempt计数相同，Provider/付费调用0。
- GitHub已发布当前分支，注释标签`v0.6.1`精确指向生产源commit `f3d3fc8b2d4cb846b446fa4a46afbdcd796e2ccf`；Draft PR为[#1](https://github.com/jasionia1991-max/unboundry/pull/1)。
- F14 生产制品固定为 commit `eb4f99ea525390b0dd7a39d3cad55d882ffea41d` / tree `86b4e424b6d6324c5f24d4c633b0cd35baf0d626`，manifest `46e2365c48b8e8bdaa1847b1767ef2974a71f2d2b47c87743793c116e5ec2adf`，inventory `ac8ca43a9f8f6724ca67bd0899185fa3952e762e0400a1f9ce34f3ecfefc2bac`，tar `0e3a96a13299efba407ba98dc6501ae97297c9a82c067827b9f9befeb2c18944`。
- 原 schema37 完整备份 SHA-256 `7f14c611faab136c1ae8e9579bc47755f7298e4ea6e2bba516c71e85670f8fca` 已完成离机恢复验证，inspection SHA-256 `b4d58243e88efe1c2c967ffab5f63ed6704d18324a80e8449ec9d3ad77e28e1d`；schema39 迁移后 inspection SHA-256 `a18f8224dd651b8217cb3d778845ee3f42b5bf91a5ff68291bfad4d4cb3ffa61`。
- 最终技术凭证为 `/var/tmp/unboundry-final-94f66e5260759e7d58096fafd30c46f812f2cd96d4a18409d18ffbf1ab338c6d/evidence/FINAL-CUTOVER-SUPPLEMENT.json`，SHA-256 `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8`，状态 `TECHNICAL_CUTOVER_VERIFIED`。凭证生成时 `userAcceptance=PENDING` 是不可改写的时点事实；用户随后确认生成任务状态已可读取，并结合此前确认老项目中大量已生成/上传素材仍在、第4项正常，生产验收现为 `USER PASS`。这不等于逐一验证了所有历史素材或所有延后功能。
- 最终切换是人工受控的 bounded cutover，不声明新的 formal controller PASS，也不声称切换后又跑了一轮 full regression。切换期间 Provider/付费生成调用均为 0。
- 五条历史 outcome-unknown attempt（86/108/116/120/122）已行政取消且禁止重试；`PROVIDER_FAILED` 只作为迁移/备份门 surrogate，不是远端 Provider 失败证据，原 REMOTE/TIMEOUT 事件保留。三条音频仅把 duration 元数据从 12.656 修正为 12.696 秒，媒体字节与 checksum 未改变。
- 切换完成后，用户另行明确授权真实生成及生产运维补验。唯一付费请求使用当时唯一已发布的文字模型 Doubao Seed，任务 `77d3feec-35c1-4b1e-87a2-c457983a8046` 一次提交、无重试，状态 `success`，结果为“真实生成验收通过”，审计成本字段为 `10,000,000 microunits CNY`。这不改写“切换期间 Provider/付费调用为 0”的历史事实。
- 公网 500MB 级上传以 513,802,240 字节 MP4 实测：POST 201、Range 206、完整下载 SHA-256 与源文件同为 `db3b808ef3ede34fa7841afb00d4ec3059c877085d901cce75c0a40fd0dfabd1`，ffprobe 正常；测试素材随后 DELETE 204 并确认不存在，生产素材数回到 416。真实 HTTPS 登录响应已确认 Session Cookie 同时具有 `Secure / HttpOnly / SameSite=Strict / Path=/`，临时账号与会话均已清理。
- schema39 日常备份入口已修复，已部署字节同时保存在 `ops/production/`：`backup-data.mjs` SHA-256 `e50ac515051b63e85dd9fb11f18632fcd28bf137dcc73f3c37a0d247366970c5`，基于本地签名清单的 30 天 OSS 保留脚本 SHA-256 `05721427c867424f846f1c1b4f2f6aa10825bc3225ec2493997a8f9f27b7b95f`；最终任务已向 `objects/backups/2026-08-14T23-15-59-569Z/` 上传 356 文件并完成 retention pass。整机离机包（运行目录、Node、systemd/nginx 与最终 schema39 数据备份）保存于 `/Users/mymy/Documents/unboundry/recovery/2026-08-15`，874,823,680 字节，SHA-256 `d3b6023f99a8d510f84ae1ca6087453f0adc5882345b5f6cac8261f1989ae109`；fresh restore inspection `PASS`，receipt SHA-256 `151c788632006faa6d5342a637f4413dbf58d44b2f30adb56c261dd34bdf3962`。

## 2026-08-14 切换前施工记录（历史）

以下内容保留当时的候选、授权、HOLD 与测试证据；凡与上方 2026-08-15 当前状态冲突，均按历史时点理解，不得用来把生产回退成旧状态。

当前施工状态（2026-08-14）：`REM-000 = PASS / REM-001～009B = USER_REVIEW / REM-010～011 = IN_PROGRESS / G5 B13-F13 COVERAGE = PASS / G6 B13-F13 = USER PASS / PRODUCTION BRIDGE EXECUTION = AUTHORIZED-GATES-IN-PROGRESS`。B13因原生产两张表的历史等价raw SQL形态而fail-close，禁止上线。B14 `3b48f61c…` / tree `c8b0d75c…` 与唯一直接子 F14 `eb4f99ea…` / tree `86b4e424…` 已形成，formal source-pair proof `517d2d24…` PASS；两版m81 41/41、tsc/source coverage/build PASS。clean F14 targeted `81/81`、三轮 full `2832/2832`、两轮 race `1420/1420` 全部 PASS，所有异常计数0、五轮均exit0，source/snapshot `6af5b891…`与4173 identity不变、suite cleaned。formal Linux artifacts/receipt仍待完成。生产 v0.5.1/schema37 继续在线；bridge 全流程已获授权，但尚未停服、写库、访问真实 OSS 或切换。

F14 本地正式门日志 SHA-256：targeted `b9d260babe051c1f89ef86256ade2d57fda19b57009ec02e6973be441b5585bf`；full1/2/3 为 `1f6f958d57ee855b0272ddd2576277deef6ea3e299e5ccdc597d4ca1d4559741` / `903096ed64412e184dcefecfc28c6fedda809c17a570d3fa8729a3d176560b0b` / `adecd5164828a87452bf5974a594c19da2e00e54f4aed281c113d57240b7917a`；race1/2 为 `3d1b64868ef60e769158b31ee4f94efbed0015d251cfdac8b48f27f8918c5a18` / `fc08356cf3bc9eb96e8b18abdd9789b96aa615361897a205240537e2ba29eb46`。full builder合计3 attempts/15 invocations，race builder合计20 attempts/100 invocations，均全绿。

用户最新明确“全部授权”：在 `v0.5.2` bridge 范围内，可连续完成第二验证机 formal Linux 门、使用或必要时安装 bwrap、真实 OSS 只读 HEAD/GET、维护挡写与停旧服务、完整备份/验签/恢复、严格条件删除唯一 `project_metadata rowid=14`、Node `22.23.2` 恢复副本补证、bridge 切换及必要回滚，中途无需逐项重复询问。formal manifest 的 Node22.23.1 绑定不改写；任一安全门失败仍须 STOP。该授权不包含 `v0.6.0`/schema39 迁移、真实 Provider/付费生成、push/tag/PR。

原生产 bwrap 预置已在不停服条件下完成：先下载并解包 Ubuntu `0.9.0-1ubuntu0.1`，确认 deb SHA-256 `1b506492…`，二进制/trimmed version-output SHA-256 分别精确等于 B14 manifest 的 `52231e1c…` / `768cbc12…` 后才安装；安装后二次哈希及 root outer→inner零capabilities、NoNewPrivs、仅loopback namespace smoke均PASS，线上服务tuple不变。

第二台非原生产 Ubuntu 验证机上的隔离 Linux production-validation 已对 B13/F13 生成正式 PASS receipt（SHA-256 `8f1ea00385828327d81bc7c9f9f7ef71a48fe87c58d6cb190ce45953a59c36eb`）：实际完成 B37→B39→F39→B39 rollback→F39 reswitch、显式 schema37→39 migration、真实 60 秒 drain、2 次 native duration probe、1 条 duration backfill、备份/验签/恢复与零成功外部出站；宿主生产路径、4173、服务身份和旧验证根均未改变。该结果是隔离候选证据，不是原生产验证、用户 PASS 或发布授权。F13 的 234 个非根依赖节点与 2026-08-12 REM-008 audit=0 的锁图逐项相同，但本轮没有刷新 advisory 数据库，因此只继承历史 audit 结论，不声称 fresh audit。

2026-08-14 用户已完成 G6 A/B/C+final 四阶段实页验收并明确“最终通过”：先在 B13/schema37 修改、保存、刷新文字节点并确认 250×250 自动换行和既有图片；完成真实 60 秒排空并执行 v37→39 one-shot migration 后，在 F13/schema39 追加 `-F39通过` 并刷新确认；再回滚到 B13/schema39 追加 `-B39回滚通过` 并刷新确认，最后重切 F13/schema39，两个后缀、图片和换行均保持。G6 用户验收证据 SHA-256 为 `d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d`。验收期间用户曾对合成禁用 Provider 点击一次“检查连接”，结果为 HTTP 400；没有付费生成或成功外部出站，`generation_provider_attempts=0`，但不得表述为“没有发生过 Provider 检查尝试”。

G5 正常请求量化先在全新 Mac synthetic-test 隔离根完成控制器资格验证，随后依 DEC-REM-007 的单次独立不可变审批绑定，在第二台非原生产 Linux 验证机对 formal B13/F13 artifacts 完成正式 supplement。外层 receipt 为 `PASS / formalG5Evidence=true`，SHA-256 `ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b`；inner candidate SHA-256 `380ec25897f8d642c379301a313a572eb20d31e75a1ffefcc454a89487b64ad0`，requests JSONL SHA-256 `15d69b90ffdd4a686fd3653f664c0ec90f933281e16757f57ce07f13e5f43a92`。审批 SHA-256 `dfc267e115b2278a30c8f6b214fe30bef05abe7f0075856fc3686b5cfecccc6b`，wrapper/controller/helper 分别固定为 `74e63ac68dd6a42f89f37dd577219adff5a4b3de320108a6e3f932aa2d8a4e43` / `41d5173e399a4b9dae0161e9d357254d5f4c6d6685af8c8b3b223cef83b82adb` / `46ec2a44fa71ba84eac7ffc02a561fedbe0a5550d3a6fa257cb8404b01d000c4`，executionId `61b1b5dfab2e78ec4fd8d93a2caa13af3f3e724cadb489133ff6b0e191d8e755`。

正式 supplement 按 `B37 → B39 → F39 → B39_ROLLBACK → F39_RESWITCH` 五阶段执行，每阶段 140 条，共 `700/700` 完整且语义有效，mismatch/reset/timeout/oversize/其他传输错误均为 0；观测 p50 `24.633ms`、p95 `74.981ms`、p99 `89.501ms`、max `103.58ms`，硬 deadline `2000ms`。`productionSlo=false`：这些是隔离非生产验证机的演练观测，不是原生产 SLO。六类 loopback 状态机自测 PASS；final schema39 integrity `ok`、FK 违约 0、migration marker 不存在、`generation_provider_attempts=0`，Provider/OSS/付费 workload 均为 0，私网、额外进程与 capabilities 均为 0。宿主 before/after SHA-256 同为 `5474649e…`，4173 listener 0、uid996 进程 0，旧验证根、服务、nginx 与原生产路径不变；本次 root 已封存，cleanup 残留 0。因 G6 C 已关闭 rollback API write 缺口，G5 coverage 现为 `PASS`。

证据边界：G5 已关闭 formal B13/F13 的流程、正常请求量化、传输分类以及 rollback 后画布 API 写入门，但只作B14/F14回归基线。原生产 `v0.5.2` bridge 的剩余验证、备份、条件修复、停服、切换与回滚已获连续执行授权；`v0.6.0` final 迁移、真实 Provider 与仓库发布动作仍未放行。

下文 2026-08-13 的 75/75、931/931 与旧 G0～G6 数字保留为形成 formal B13/F13 之前的历史过程证据；若与上面的 2026-08-14 当前状态冲突，以上述当前状态为准。

历史 REM-009B 证据保持不变：合成富数据、媒体、密钥和假 OSS 上完成格式 2 备份/恢复、one-shot exact-v37→schema39 迁移、故障恢复、假 OSS 重建及 exact-v0.5.1→当时所谓 current bridge→schema39 数据格式与安全拒绝边界矩阵；当时同内容功能树核心三轮 `399/399`、安全全量 `114/114 spec、912/912 PASS`，源码 `303 = 283 TS/TSX + 20 JS/MJS`、运维脚本 `15 = 12 行为 + 3 冻结`。后续审计确认其中 bridge/exact/candidate 是合成夹具：当前 runtime 遇 schema37 只进入 `schema37-health-only-standby`，业务 API 返回 `SERVICE_SCHEMA_STANDBY`，不能作为迁移前正常营业的桥梁。该历史证据仍证明备份、迁移和安全拒绝边界，但不是可部署 bridge、当前 REM-010 动态结果、用户 PASS、真实数据/Provider/OSS、生产迁移或发布证明。

已冻结的修正方案是单一不可变 `v0.5.2` 双引擎桥梁：外层 supervisor 只读探测数据库版本并统一承担唯一公网监听、runtime role、active lease 与 request/SSE/generation drain；schema37 选择内嵌的 exact-v0.5.1-compatible 引擎，只开放登录/会话、项目/画布等基础业务读写与既有媒体读取，生成提交/重试/取消、上传/删除/发布等高风险 generation/media mutation 一律 fail-close，离线验证 `generation_provider_attempts=0` 且成功外部出站为 0；schema39 选择内嵌的 v0.6.0-compatible 业务引擎并可作迁移后回滚目标；schema38/未知版本只允许维护态 fail-close。启动和健康检查不得迁移；显式 one-shot migrator 只能在维护、排空和备份完成后运行。两个引擎、锁文件和构建输入都必须进入 manifest 并独立哈希，运行时不得依赖 Git 或网络。

F-054 实现审计的四项 P1 已闭环：exact-v0.5.1 child 使用不含 ffmpeg/ffprobe 的受控 PATH，warmup 只补 checksum，duration 继续 pending 直到显式 migrator；bridge/final 共用由 safe runner 持有并可重复验证身份与哈希的 ffmpeg/ffprobe 先决件；release source-pair 证明 `0.5.2→0.6.0` 只发生 package/lock 三个版本值变化；m92 只从认证 attestation 取得并运行 bridge/final 及 bridge 产物内 migrator，不再使用当前 checkout 或手写 shim。有效 PCM WAV 回归证明唯一 duration 在 bridge 启动前后均为 pending，显式迁移恰好回填 1 条，final 恰好读到 1 条 ready。

首轮七个关键 spec 为 `74/75`，唯一失败是 m92 夹具使用 `fetch` 时未保留显式 `Host: canvas.mymy.ltd`；产品的严格代理头规则没有放宽，夹具改用 `node:http` 后 m92 `2/2 PASS`。最终定向门发现 `117 specs / 938 tests`，执行 `7 specs / 75 tests`且 `75/75 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=186`，builder `attempts=1 / builderInvocations=5 / passed=1 / failed=0`。证据绑定 HEAD `8f607cdb5f70d760033699077dab738575a4ea69` 下文档同步前 440-file source/snapshot SHA-256 `47fc53b93eaa6af2379484211979d7cec5199bc21dada1b424b0561f59d4c084`，前后不变；日志 SHA-256 `4e41ed6f23795eb161746c8d370bc75bf4570a0e3798f0358e2f7832a7a334db`，4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 不变，suite cleaned、exit 0。这是 Mac synthetic direct-child/artifact 定向门，不是 full、三轮全新环境、关键竞态压力、formal release commit 或 Linux/production 验证。

`1e96e26f…` 是早期 m92 maintenance-mode fixture 窄修复后、上一轮六文档同步前脏功能树的历史 tested source 指纹；该 full 不绑定 commit，也不是 fixed clean/formal candidate。

2026-08-13 用户随后在隔离手工验收页发现两个历史自动检查缺口：工作空间的虚拟 `default` 卡片错误进入 `/canvas/default` 后回跳，以及 `Text → Video` 已有有效文字仍被强制要求重复填写 Video 本节点 Prompt。当前候选已统一把默认卡片导向规范 `/canvas`，并规定 Video 的最终 Prompt 可由已就绪上游 Text、Video 本节点 Prompt或两者合并提供；两者都为空时仍阻止。m11+m30 经唯一安全入口定向 `17/17 PASS`，任务/付费 Provider 请求为 0。该定向结果绑定修复后、文档同步前源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be`。用户随后在端口 58352 的同一隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。

两项页面修复后的首轮 full 为 `930/931 PASS`，唯一失败是 m44 两个协作进程并发打开 current DB 时，竞争者把 reservation 正常创建写入或释放造成的 metadata 变化误判为篡改。产品并发协议已把合法状态严格区分为 `initializing / active / released`，继续对 stale、self-PID、malformed、unsafe、替换或非协作路径 fail-close；m91 在同一既有测试内加入创建前与释放窗口的确定性双进程回归，m44+m91 定向 `15/15 PASS`。随后 fresh full 在 Node `22.23.1` / npm `10.9.8` 下达到 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`，builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file、文档同步前源码快照 `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，前后不变；4173 listener 仍为 `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit 0。

上述脏树单轮证据随后冻结为首个 clean candidate `b9b4691`，但其在后续压力运行中被真实 SQLite sidecar 交接竞态击穿，不再是有效候选。`8b639ffe6c5f091c51e1914f2e2c18edf9333d90` 以 held-reader 窄修复取代：完整 WAL/SHM 对（包括零字节 WAL）使用普通只读检查，并将 inspection 读事务保持到新 writer 取得 `BEGIN IMMEDIATE`、完成 identity/sidecar/schema/digest 复核后再释放；symlink、hardlink、unsafe mode、orphan sidecar 和 journal 仍立即 fail-close。m91 对 hot-WAL 和 zero-WAL 的旧最后连接关闭均有确定性回归。

固定候选完成三个独立 fresh full：每轮 `117/117 specs、931/931 PASS`，三轮合计 `2793/2793`；每轮 failed/skipped/retries/reportErrors/blocked 均为 0、`deniedViteWildcardProbes=534`、builder `1/3/1/0`，合计 builder `3/9/3/0`，日志 SHA-256 前缀依次为 `c5a8da15… / 06aed03d… / edbb4550…`。关键竞态包另外两轮均为 `5 specs × repeat 10 = 570/570`，合计 `1140/1140`，每轮异常计数全 0、`deniedViteWildcardProbes=1980`，各关键场景累计 20 次，日志 SHA-256 前缀为 `881023af… / edefe9ea…`。五轮均使用 Node `22.23.1` / npm `10.9.8`，snapshot 前后不变，4173 listener `dfd25fc2…` 前后不变，suite cleaned、exit 0。

production HOLD 仅表示前置安全门尚未闭合，不再表示缺少 bridge 授权：B14/F14 source pair、exact schema contract及本地targeted/full/race自动门已完成；formal Linux artifacts、真实备份与OSS恢复材料、条件式FK修复以及Node22.23.2副本门正在依次关闭。全部通过后可直接切换 `v0.5.2` bridge；final `v0.6.0`迁移、真实Provider、push/tag/PR继续禁止，schema39仍只存在于隔离候选。

**新接手的人（含 AI agent）必须按顺序阅读：**

1. `AGENTS.md` —— 项目级施工红线与上下文恢复协议
2. `README.md`（本页）—— 项目身份与统一阅读入口
3. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md` —— 用户已确认的全量修复、测试、发布和回滚权威施工合同
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` —— 当前 REM 状态、授权边界和下一步硬停止点
5. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md` —— 快速上手、环境、红线与历史现状
6. `TASKS.md` —— 工作日志与当前 REM 状态
7. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` —— 逐项验收状态

发生冲突时，以用户最新明确指令为最高权威；无法从仓库文档、Git 和当前证据恢复一致状态时必须停止，不得凭记忆或压缩摘要继续。

仓库根：`/Users/mymy/Documents/unboundry/app`
