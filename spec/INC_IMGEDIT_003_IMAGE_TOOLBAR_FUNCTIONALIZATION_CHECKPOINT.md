> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-IMGEDIT-003 图片工具栏剩余能力施工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-24 02:27:58 +0800
- 状态：`GOAL_COMPLETE / D13_AUTO_PASS / V0_6_35_PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK`
- 当前阶段：`D13 GitHub和生产发布 / AUTO_PASS`
- 唯一允许的下一动作：停止真实Provider调用；由用户在生产画布复验多角度、重绘未遮罩保持、扩图延续、擦除补景、创意增强保真和主体抠图边缘质量。只有用户明确确认后才可记录`USER_PASS`
- 当前仓库：`/Users/mymy/Documents/unboundry-inc-imgedit-003-v0.6.34-2026-08-23`
- 记录时分支：`codex/v0.6.35-production-receipt-2026-08-24`
- 记录时 HEAD：`b077306aa344bc122ba566c806f27ffe2e3c4d16`
- 记录时 `origin/main`：`cc62bfbb155372ba3b1da65c029d9c97b5330ac7`
- package：`0.6.35`
- 生产：`v0.6.35 / schema39 / PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK`
- 已发布版本：`v0.6.35 / VERSION_AND_RELEASE_AUTH_CONSUMED`
- 热修版本：`v0.6.35 / SAFE_FULL_1052_OF_1052_PASS / PR_81_MERGED / TAGGED / MAIN_CI_PASS / PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK`
- 候选：`v0.6.34 / LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS / PR_MERGED / TAGGED / PRODUCTION_PUBLISHED_AUTO_PASS`
- 本轮代码施工：`v0.6.34` 已冻结发布；生产真实操作在 Provider 前暴露多角度缺失 `imageTool` 身份、六项生成工具共同使用非法持久输入顺序0、以及源节点1K被模型默认2K覆盖三项缺陷；本地热修提交 `a411a63` 已补齐身份、统一顺序为1并继承经模型规范化的源参数
- 本轮验证：pinned Node 22.23.1/npm 10.9.8；D12原证据保持冻结前定向 `234/234 PASS`、唯一一次 safe full 原始 `1048/1052`、精确修复集合 `106/106 PASS`且未运行第二次full。热修最终安全定向 m100+m2+m27 `43/43 PASS`、退出0、retries/skips/reportErrors均0、source/snapshot `1350e3adc56c98c9cafc0faea685f6c8f1648852b5a04536d933901d9c014a80`、4173监听者不变、外部/Provider请求0。v0.6.35版本同步后执行m38+m81，`56/56 PASS`。冻结候选`c1a4a08e23bc917d85970d3bdffd82a44899970e`随后只执行一次新的safe full：120/120 specs、`1052/1052 PASS`、退出0，blocked/failed/retries/skips/reportErrors均0，source/snapshot`c5eb339edd87245e99cdf53f13c3456325639a7ffb9426fcf5d312896b530135`，immutable release builder 1/1且5次builder invocation符合预期，4173监听者不变、外部/Provider请求0。多角度证据回写后只运行m38文档/恢复权威定向，`15/15 PASS`。重绘证据回写后再次只运行m38：`15/15 PASS`、退出0、blocked/failed/retries/skips/reportErrors均0、source/snapshot `5a391d5ce9c256e4625eb049a8072b57ccfe6d1440cf8010405f04fa0784f13e`、4173监听者不变。六项最终收口后只运行m38：`15/15 PASS`、退出0、blocked/failed/retries/skips/reportErrors均0、source/snapshot `06932c71d249bc5f877124680db1c644859265f45a56b17ecb0bb4a099d01fa2`、4173监听者不变；未重复full
- 真实 Provider/付费请求：6/6，当前可确认费用60 USD；用户总预算上限60 USD。六项分别对应DB attempts `756～761`、Provider `113882656/113886725/113888063/113888832/113889816/113890583`，均一次提交、无重试并成功；剩余授权0次/0 USD
- 真实 OSS 测试对象：本地派生技术冒烟新增8个 Media 资产并保留；无删除
- GitHub/SSH/生产操作：v0.6.35产品PR #81已squash merge为`cc62bfbb155372ba3b1da65c029d9c97b5330ac7`；PR CI `32654662421`与main CI `32654691812`成功；注释tag `v0.6.35`解引用为`fc99101327efc8fc3687406598169a6ae7dc1272`，tag与main tree均为`cb13fef2e71e41c3ada09ade95619c9362636b36`。生产已从精确tag fresh build并原子切到`/opt/unboundry/releases/v0.6.35-image-toolbar-hotfix-20260824`

## 1. 权威恢复顺序

每次新 Session、上下文压缩、换 Agent 或执行中断后，必须按顺序完整阅读：

1. `/Users/mymy/Documents/unboundry/app/AGENTS.md`
2. `/Users/mymy/Documents/unboundry/app/上线规矩.md`
3. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_CURRENT_STATE.md`
4. `/Users/mymy/Documents/unboundry/app/README.md`
5. `/Users/mymy/Documents/unboundry/app/TASKS.md` 顶部当前区块
6. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md`
7. 本 Checkpoint
8. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 顶部与 `IMGEDIT-001～020`
9. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`
10. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md`
11. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md`
12. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_GOAL_PROMPT_2026-08-23.md`

如果根 `AGENTS.md` 要求额外权威文件，继续完整阅读，不得用本清单缩减项目规则。

## 2. 恢复后只读核对

```bash
pwd
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin main --prune
git rev-parse origin/main
node --version
npm --version
node -p "require('./package.json').version"
```

随后比较实际 branch、HEAD、工作树、package、schema、当前阶段、外部请求计数和测试证据。任何冲突先更新真实断点，不得凭记忆继续。

## 3. 文档驱动纪律

- 同时最多一个 D 阶段为 `IN_PROGRESS`；
- 开始阶段前先把本文件的阶段改为 `IN_PROGRESS`；
- 完成阶段后先回写本文件、验收矩阵和 TASKS，再进入下一阶段；
- CURRENT_STATE 只在版本、候选、GitHub或生产事实改变时更新；
- 不允许代码已经跨入下一阶段而 Checkpoint 仍停在上一阶段；
- 每次更新必须记录真实命令、结果和退出码；
- 树未变化时复用有效测试证据，不为安心重复 full；
- 聊天、内部记忆和压缩摘要不是状态依据；
- 每次恢复只从“唯一下一动作”继续。

## 4. 阶段总表

| 阶段 | 内容 | 状态 |
|---|---|---|
| D0 | 实时基线和文档恢复 | AUTO_PASS |
| D1 | 合同、矩阵和架构门 | AUTO_PASS |
| D2 | 最小图片工具应用层 | AUTO_PASS |
| D3 | 颜色标记、调整像素、快速分割 | AUTO_PASS |
| D4 | 标注 | AUTO_PASS |
| D5 | 个人素材库 | AUTO_PASS |
| D6 | 模型和处理引擎调查 | AUTO_PASS |
| D7 | 多角度 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| D8 | 遮罩基础与重绘 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| D9 | 扩图与擦除 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| D10 | 增强与主体抠图 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| D11 | Seedance 素材校验 | AUTO_PASS |
| D12 | 候选冻结和统一验证 | AUTO_PASS / FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS |
| D13 | GitHub和生产发布 | AUTO_PASS / V0_6_35_PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |

## 5. 验收条目状态

历史 `IMGEDIT-001～009` 保持原状态，不改写历史证据。新功能条目初始状态：

| 条目 | 内容 | 状态 |
|---|---|---|
| IMGEDIT-010 | 图片工具应用边界、状态和操作启用 | AUTO_PASS |
| IMGEDIT-011 | 颜色标记 | AUTO_PASS |
| IMGEDIT-012 | 个人素材库 | AUTO_PASS |
| IMGEDIT-013 | 调整像素 | AUTO_PASS |
| IMGEDIT-014 | 快速分割 | AUTO_PASS |
| IMGEDIT-015 | 标注与导出 | AUTO_PASS |
| IMGEDIT-016 | 多角度真实生成 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| IMGEDIT-017 | 重绘真实生成 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| IMGEDIT-018 | 扩图与擦除 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| IMGEDIT-019 | 增强与主体抠图 | TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK |
| IMGEDIT-020 | Seedance 素材校验 | AUTO_PASS / LOCAL_TECHNICAL_PREFLIGHT_ONLY |

## 6. 当前工作树保护

落档开始时已有多份用户文档修改和两个未跟踪文件。本任务只窄改图片工具计划、Checkpoint、Goal 提示词、TASKS 当前区块、CURRENT_STATE 当前区块和验收矩阵图片工具行；所有其他修改继续视为用户已有工作。

受保护的未跟踪文件：`spec/public-templates-director-split-revision.json`。永久禁止读取、修改、格式化、暂存、提交、删除或改名。禁止 `git reset --hard`、`git clean` 和覆盖用户数据。

## 7. 版本、Git和发布门

- 本 Goal 原目标版本由用户明确确认为`v0.6.34`且已发布；该版本号、tag和发布授权现已消费，`v0.6.33`不复用；
- 用户已于2026-08-24明确确认`v0.6.35`并独立回复“按v0.6.35上线吧”；该授权只覆盖共同生成热修的冻结、GitHub、生产发布与Goal内预算冒烟；
- 只有 D12 冻结与统一验证通过后才可进入 D13，版本与发布门有效不等于提前获得发布成功结论；
- 本次版本号和发布授权只覆盖 INC-IMGEDIT-003 当前合同，不扩大到历史任务或暂停项；
- 自动测试、真实技术冒烟、生产技术通过和 `USER_PASS` 必须分开。

## 8. 真实请求预算账本

| 操作 | 成功上限 | 已用 | 备注 |
|---|---:|---:|---|
| 多角度 | 1 | 1 | v0.6.35一次真实提交成功：task `a7798cf3…ed2b`、attempt 1、Provider task `113882656`、10 USD；Media发布、Canvas挂接和刷新恢复通过，无重试 |
| 重绘 | 1 | 1 | v0.6.35一次真实提交成功：task `5fd3d1fd…8c2b`、attempt 1/DB `757`、Provider task `113886725`、10 USD；Media发布、Canvas节点/来源边、云端保存与刷新恢复通过，无重试 |
| 扩图 | 1 | 1 | v0.6.35一次真实提交成功：task `9fa04634…33d0`、attempt 1/DB `758`、Provider `113888063`、10 USD；Media发布、Canvas节点/来源边、云端保存与刷新恢复通过，无重试 |
| 擦除 | 1 | 1 | v0.6.35一次真实提交成功：task `16e3bc55…2cda`、attempt 1/DB `759`、Provider `113888832`、10 USD；Media发布、Canvas节点/来源边、云端保存与刷新恢复通过，无重试 |
| 创意增强 | 1 | 1 | v0.6.35一次真实提交成功：task `2108f76b…634b`、attempt 1/DB `760`、Provider `113889816`、10 USD；Media发布、Canvas节点/来源边、云端保存与刷新恢复通过，无重试 |
| 保守增强 | 0 | 0 | 本 Goal 已在生产用本地引擎完成，不占真实 Provider 预算 |
| 主体抠图 | 1 | 1 | v0.6.35一次真实提交成功：task `a17cc9e5…a178`、attempt 1/DB `761`、Provider `113890583`、10 USD；透明PNG Alpha、Media发布、Canvas挂接和刷新恢复通过，无重试 |
| 兼容复核 | 0 | 0 | 用户最新金额确认把总上限收紧为6次；不另留第7/8次 |
| 合计 | 6 | 6 | 当前确认60 USD，预算与次数均已用完；禁止追加真实Provider请求 |

## 9. 阶段更新模板

每次阶段切换在本文件追加：

```text
时间：
阶段：D?
状态：IN_PROGRESS / AUTO_PASS / BLOCKED
branch / HEAD / origin-main：
工作树摘要：
产品文件：
测试文件：
文档文件：
package / schema / candidate：
外部请求和付费预算：
测试命令、环境、结果、退出码：
架构与数据风险：
设计偏差：
阻断：
回滚点：
唯一下一动作：
```

## 10. 当前唯一下一动作

用户已确认“最多6次、总预算上限60 USD”，并于2026-08-24对第1项多角度“预计10 USD”按钮明确回复“确认提交”。首次点击发生在仍载入v0.6.34脚本的旧标签页，只形成未保存占位，数据库保持tasks/attempts `722/730`、active0、publication attempts361，0 Provider、0 USD；应用保留本地恢复副本后打开服务器版本，没有删除任何已保存数据。载入v0.6.35后，同一已确认动作一次真实提交成功：task `a7798cf3-9473-45b3-ae4d-397a0876ed2b`、attempt 1、Provider task `113882656`、10 USD；结果Media `4671b388-b663-495a-9c8c-e96447a3cfa4`为PNG `1088×1920`、2,504,877 bytes、SHA-256 `a67b6216213673eb78a075bb122437d5b9b5f778041f7917f3a60fc18ed53f46`，Canvas节点、来源边、云端保存和刷新恢复均通过。

用户随后明确回复“确认提交剩余5项，总额不超过50 USD”，构成重绘、扩图、擦除、创意增强、主体抠图的动作时分组确认。第2项重绘使用安全测试图，仅对左上背景建立有界框选mask，页面显示预计10 USD；只点击一次提交。task `5fd3d1fd-314d-49ba-a833-540be1f38c2b`、attempt 1/DB `757`、Provider task `113886725`一次成功，actual cost `10,000,000` microunits USD；结果Media `898f87f6-18a9-4c1b-93fd-b61fc5daf889`为ready PNG `1536×2731`、3,576,345 bytes、SHA-256 `61514fbecfaf1719d8b7bdfb3af3378111a9b24e40e1c8cfbb2824dfaf89e59e`，publication `f7a2d7a6-7af1-4acd-87fe-79f15f09f0a9`为published。Canvas revision21/graphRevision20包含节点`image-redraw-08156800-4cf9-487c-9eb7-11bba94b8df3`、结果asset和来源边，页面云端保存、刷新后节点/提示词/上游引用均恢复。

第3项扩图以重绘结果为安全来源，使用默认四周25%和“只生成新增边界”，只点击一次提交。task `9fa04634-580d-418c-a5e9-470caea433d0`、attempt 1/DB `758`、Provider `113888063`一次成功，actual cost `10,000,000` microunits USD；结果Media `def2fc19-582a-4ef7-9c19-4c3cae3b9fb3`为ready PNG `1536×2731`、3,426,058 bytes、SHA-256 `0a2f130b3d4f2f35691271de12721b3e29a9f76135dd5efb250f21c90e9a6350`，publication `a3a9ed85-bcc6-44c2-ab71-c1130d62cfa5`为published。Canvas revision25/graphRevision24包含节点`image-outpaint-1e680a2c-fa5c-4d75-817c-82850f7fedf2`、结果asset和来源边，页面云端保存、刷新后节点/提示词/上游引用均恢复。生产计数tasks/attempts `725/733`、active0、publication attempts367。账本为3/6、30 USD；剩余3项上限30 USD。

第4项擦除以扩图结果为安全来源，只对左下地面纹理建立有界框选mask，页面显示预计10 USD；只点击一次提交。task `16e3bc55-8aab-4947-bf1b-0974a65a2cda`、attempt 1/DB `759`、Provider `113888832`一次成功，actual cost `10,000,000` microunits USD；结果Media `127fd497-bd7d-4061-99a3-a0b6aae1faf9`为ready PNG `1440×2560`、3,036,592 bytes、SHA-256 `7b15bda86e6001209fd1d3c715e91b91eb0f2a888764c702aeb68e9bdf0759e0`，publication `baf54c05-c63a-4e40-a29c-6c1c967b0a37`为published。Canvas revision29/graphRevision28包含节点`image-erase-ff88716a-6877-46db-a402-d62525143ce7`、结果asset和来源边，页面云端保存、刷新后节点/提示词/上游引用均恢复。生产计数tasks/attempts `726/734`、active0、publication attempts369。账本为4/6、40 USD；剩余2项上限20 USD。

第5项创意增强以擦除结果为安全来源，选择“创意增强（会改变内容）”一次，生成提示固定为保持主体身份、构图和主要颜色并允许补充自然纹理；只形成一个持久task且没有重复Generate。task `2108f76b-2680-40e9-aeac-4f9c52cb634b`、attempt 1/DB `760`、Provider `113889816`一次成功，actual cost `10,000,000` microunits USD；结果Media `f9479a2f-af6e-4ab5-b0a2-4dd4a324ffdc`为ready PNG `1440×2560`、3,583,516 bytes、SHA-256 `b9d2d489388ba6cbd7090305ba745416e73ae9b9b3b5ca33a0d28fa27d78298f`，publication `0f48af83-c916-4e21-a243-1c4dabbaba7c`为published。Canvas revision33/graphRevision32包含节点`image-enhance-creative-de5654a5-510d-4846-bb9a-45f68272b15a`、结果asset和来源边，页面云端保存、刷新后节点/提示词/上游引用均恢复。生产计数tasks/attempts `727/735`、active0、publication attempts370。账本为5/6、50 USD；剩余主体抠图上限10 USD。

第6项主体抠图以创意增强结果为安全来源，选择“生成透明PNG”一次并自动提交；没有第二次Generate或重试。task `a17cc9e5-0fd1-4f8f-bd5d-84ac0ceba178`、attempt 1/DB `761`、Provider `113890583`一次成功，actual cost `10,000,000` microunits USD；结果Media `41c5faed-db41-44da-811d-d6775246a849`为ready PNG `1440×2560`、4,095,410 bytes、SHA-256 `c51a8508a22ab5dc38e885f65eb814c8bfb08f02d2e6a214d934bfffb2dfe221`，publication `17a2bb99-bc34-4b51-be3a-a6528c8796e0`为published且retry_count0。只读OSS字节核验确认PNG为8-bit RGBA、colorType6、非交错，3,686,400像素中透明1,474,164、部分透明2,212,069、不透明167，Alpha范围0～255，真实Alpha通过。Canvas revision37/graphRevision36包含节点`image-remove-background-c873f451-48e4-4afc-ad76-93b9f806577c`、结果asset、`imageToolOutputBackground=transparent`和来源边；重新打开生产画布后节点标题、透明PNG提示词、上游引用和“已保存到云端”均恢复。生产最终计数tasks/attempts `728/736`、active0、publication attempts371。总账6/6、60 USD，预算与次数均已用完。

### 2026-08-24 上下文恢复只读复核

- 实时工作区为`/Users/mymy/Documents/unboundry-inc-imgedit-003-v0.6.34-2026-08-23`，分支`codex/v0.6.35-production-receipt-2026-08-24`，恢复前HEAD`9be4255b25a14b35fd12b536ec8a6304dcbc0123`，跟踪工作树干净，`origin/main=cc62bfbb155372ba3b1da65c029d9c97b5330ac7`；package `0.6.35`，Node `22.23.1`、npm `10.9.8`。
- 生产只读探针重新确认`version=0.6.35`、live、ready active/schema39；没有生成、Provider、OSS或生产写动作。
- 发现并纠正`AGENTS.md`当前权威状态仍写0/6的文档漂移；真实状态继续以Checkpoint、计划、TASKS、矩阵、CURRENT_STATE、生产证据和Git为准：`1/6 / 10 USD`。本次只同步治理文档，不改变D13阶段、预算或验收等级。
- 文档同步后按风险分层仅复验`tests/m38-generation-runtime-incidents.spec.ts`：`15/15 PASS`、0失败、0重试；safe runner确认源码快照前后不变、4173监听不变。未重复全量测试。
- 自动续跑再次按顺序只读恢复后确认实时HEAD`9dbbe8fc3040d316e8852052c345a783578ae00a`、`origin/main=cc62bfbb155372ba3b1da65c029d9c97b5330ac7`、package `0.6.35`、跟踪工作树干净，生产version/live/ready仍为`0.6.35 / live / active schema39`。同时发现CURRENT_STATE下部“当前线上/新会话默认动作”、矩阵017～019预算说明、模块化恢复入口和裁剪专项当前生产语句仍残留v0.6.33或0/6时点，已按顶部权威事实做docs-only对齐；没有改变历史发布段、产品代码、预算或验收等级。对齐后仅复验m38：`15/15 PASS`、0失败、0重试、退出0，source/snapshot `6adff8eb99c7ee442675b20cfc4a10e240c807b3e8f797fc4adaed855f112aaa`、4173监听不变；裁剪专项末句仅澄清当前承载版本，不影响测试并按纪律未重复full。
- 2026-08-24 02:27主体抠图逐项完成；六项均一次成功、无重试，总账6/6、60 USD。D13整体收口为`REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK`；唯一下一动作改为用户生产视觉质量复验，不再允许真实Provider调用。

## 26. D13 GitHub 和生产发布

- 时间：2026-08-24 01:33:15 +0800
- 阶段：`D13`
- 状态：`AUTO_PASS / V0_6_35_PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`main` / `cc62bfbb155372ba3b1da65c029d9c97b5330ac7` / `cc62bfbb155372ba3b1da65c029d9c97b5330ac7`
- 工作树摘要：产品PR #81和v0.6.35生产发布已完成；本轮没有产品或测试代码修改，只把多角度一次真实技术冒烟证据回写到8份权威文档。当前HEAD为上一文档checkpoint提交`c5c5f71`，本次证据更新尚未提交
- 产品文件：本次无修改；已发布热修仍由`ImageNode.tsx`、`generationImageToolUseCase.ts`和四个生成use case承担身份、顺序1及源1K继承
- 测试文件：本次无修改；复用热修m2/m100/m27既有43/43证据，只运行直接受文档变化影响的m38
- 文档文件：本 Checkpoint、`TASKS.md`、验收矩阵、CURRENT_STATE、README和上线规矩同步当前阻断；不把本地热修冒充已发布能力
- package / schema / candidate：`0.6.35 / schema39 / SAFE_FULL_1052_OF_1052_PASS / PR_81_MERGED / TAG_FC99101 / MAIN_CC62BFB / TREE_CB13FEF / PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_RECHECK`
- 外部请求和付费预算：用户于2026-08-24明确确认“最多6次、总预算上限60 USD”，并先对多角度单项、再对“剩余5项总额不超过50 USD”作动作时确认。六项均只提交一次并成功，Provider依次为`113882656 / 113886725 / 113888063 / 113888832 / 113889816 / 113890583`，actual cost各`10,000,000` microunits USD；数据库tasks/attempts为`728/736`、active0，当前预算`6/6 / 60 USD`，剩余`0次 / 0 USD`
- 测试命令、环境、结果、退出码：热修安全定向 m100+m2+m27 `43/43 PASS`；版本同步后m38+m81 `56/56 PASS`。冻结候选`c1a4a08`上按Runbook只执行一次safe full，120/120 specs、`1052/1052 PASS`、退出0，blocked/failed/retries/skips/reportErrors均0，source/snapshot`c5eb339e…30135`，immutable release builder 1/1且builderInvocations 5/5，4173 listener不变、外部/Provider请求0。六项最终证据回写后执行`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`，`15/15 PASS`、退出0、source/snapshot `06932c71…1fa2`、4173 listener不变；没有重复full
- 架构与数据风险：v0.6.34 tag/release继续不可变并保留为回滚点；真实生成逐项受预算和计费状态门约束。服务器旧明文备份脚本首次只覆盖主库与媒体365文件，漏掉现有Library sidecar；切换前已用Node SQLite online-backup形成一致`library.sqlite`并同时加入frozen-source和restore-copy，重算双清单后各366文件、SHA均`041240d5…0bde`，Library schema1/integrity ok/FK0/entries1。GPT Image 2生产参考素材上限保持1
- 设计偏差：动作时确认后的首击发生在仍载入旧脚本的标签页，只形成未保存占位且明确0 task/0 attempt/0 Provider/0 USD；应用保留该本地恢复副本并另开服务器版本。载入v0.6.35后，同一已确认动作才一次真实提交并成功，未对未知计费结果重试。Media publication的`adopted_at`字段保持空，但Canvas数据库revision17明确包含结果asset、目标节点和来源边，页面显示已保存并刷新恢复；因此以实际Canvas引用证明挂接，不误用仅针对上传adoption的可选字段
- 阻断：生产与工程无阻断；用户质量验收尚未完成，不得记录`USER_PASS`
- 回滚点：上一不可变release`/opt/unboundry/releases/v0.6.34-image-toolbar-20260823`与完整冻结备份`/var/lib/unboundry-rollbacks/v0.6.35-frozen-ad7b91`均保留；v0.6.35 release不覆盖旧目录
- 唯一下一动作：停止真实Provider调用；由用户在生产画布完成六项视觉质量复验，明确确认后再记录`USER_PASS`

## 25. D12 候选冻结和统一验证

- 时间：2026-08-23 23:39:00 +0800
- 阶段：`D12`
- 状态：`AUTO_PASS / LOCAL_ENGINEERING_COMPLETE / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS / D13_READY`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `422408b9bafdce06491398e5c60e443522a479ec` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：v0.6.34 冻结候选为 `aa67e46`；唯一一次 safe full 后只修改一个真实产品缺陷和三个失败规格的确定性观测，修正提交为 `422408b`。本次收口前工作树干净，D0～D11 范围未扩张
- 产品文件：冻结时为`package.json`、`package-lock.json`、`server/bridgeRuntimeMode.ts`；full 后只修正 `server/generationTasks.ts` 的图片预检拒绝标量快照
- 测试文件：`tests/m81-deployment-hardening.spec.ts`；full 后只修正 `tests/m0-shell.spec.ts`、`tests/m22-group-execution.spec.ts`、`tests/m37-media-upload-transactions.spec.ts` 的异步/时序观测；D0～D11 直接受影响矩阵复用既有 m2/m5/m8/m10/m11/m20/m25/m27/m38/m53/m57/m81/m87/m88/m100
- 文档文件：本 Checkpoint、`README.md`、`上线规矩.md`、`TASKS.md`、`UNBOUNDRY_CURRENT_STATE.md`、验收矩阵、主方案
- package / schema / candidate：`0.6.34 / schema39 / LOCAL_ENGINEERING_COMPLETE / D13_READY`；版本门和发布门均有效
- 外部请求和付费预算：总计 `0/8`；真实 Provider/OSS、GitHub/SSH/生产写入均0
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。冻结前 m38 `15/15`、m81 `41/41`、13-spec统一矩阵 `178/178 PASS`，合计 `234/234`。冻结提交 `aa67e46` 上执行本 Goal 唯一一次 `node scripts/run-safe-tests.mjs full`：120/120 specs执行，原始 `1048/1052`，无retry/skip/reportError；四个失败为 m0 异步fixture观测、m22 fit-view与slider时序、m31图片预检拒绝丢失、m37瞬态persistence-ready观测。未改树精确复验四spec稳定为 `102/106`。修正后只运行同一四spec，`106/106 PASS`、退出0，source/snapshot `575f1dc5…ba8b`。D12文档收口首次误写不存在的m38路径，preflight后在选择阶段退出1且产品测试0；改用真实 `tests/m38-generation-runtime-incidents.spec.ts` 后 `15/15 PASS`、退出0，source/snapshot `b2d69412…1099`。4173 listener始终保持 `24c91e…8244`；没有第二次full，原始full不改写为全绿
- 架构与数据风险：代码审查确认 ImageNode 没有新增原生 fetch、Provider分支、任务轮询或SQL；Dispatcher/use case承担执行编排，CanvasSurface没有按图片工具名分支，generationTasks使用统一图片工具身份校验。架构门仍为76个既有例外、新增0。数据审查确认主库schema39不变，Library schema1 sidecar对v0.6.33可忽略，固定锁序、删除保护、备份恢复、owner和Media发布由 m10/m11/m25/m87/m88覆盖。测试审查确认120 specs/1052 tests清单稳定、source coverage稳定，mask/outpaint/erase/Alpha/capability/stale/OpenAPI/UI均有直接覆盖
- 设计偏差：当前规则不允许自行创建 subagent，故候选冻结后的独立审查由主 Agent按代码、架构、数据、测试四个互斥清单逐项执行并留下命令/证据，不虚构第二审查人。full 暴露 m31 真缺陷：`strictGenerationPreflight` 在后续追加问题前展开返回对象，数组仍共享但 `canSubmit` 标量停留为true；修正为所有校验完成后再构造公开结果。其余三项只收紧测试确定性，不放宽产品合同
- 阻断：无；D12 完成，D13 版本与发布门有效
- 回滚点：冻结候选 `aa67e462e789cd870100e378d6a2fc1ea2ceab3e`；修正候选 `422408b9bafdce06491398e5c60e443522a479ec`
- 唯一下一动作：提交 D12 收口文档；随后先把 D13 标为 `IN_PROGRESS`，完整阅读 `RELEASE_RUNBOOK.md` 并按其执行

## 24. D11 Seedance 素材校验

- 时间：2026-08-23 22:52:37 +0800
- 阶段：`D11`
- 状态：`AUTO_PASS / LOCAL_TECHNICAL_PREFLIGHT_ONLY`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `2a30be84dad83bee70474135fd8b1e6df6600176` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D10 已提交为`2a30be8`；D11 未提交树完成本地技术预检 API、规则版本指纹、owner-scoped Media 与已发布 Seedance 模型查询、节点持久化结果、刷新恢复和 stale 展示，未进入 D12
- 产品文件：`types/imageTools.ts`、`server/seedanceAssetValidation.ts`、`server/imageToolApplicationApi.ts`、`server/imageToolCapabilityRegistry.ts`、`server/modelCatalog.ts`、`server/mediaApplicationApi.ts`、`server/applicationComposition.ts`、`server/openApi.ts`、`vite.config.ts`、`client/src/imageTools/seedanceAssetValidationUseCase.ts`、`client/src/canvas/ImageNode.tsx`、`ProbeNode.tsx`、`client/src/models/ModelCatalog.tsx`、`client/src/styles.css`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`、`tests/m20-api-contract.spec.ts`
- 文档文件：本Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`、主方案偏差段
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本`v0.6.34`
- 外部请求和付费预算：总计`0/8`；视频生成、真实Provider/OSS、GitHub/SSH/生产写入均0
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。m100 首轮 `13/13 PASS`，m20 `1/1 PASS`；m2 首轮 `9/10`，唯一失败为新增本地可用操作后既有可用按钮精确计数仍期望7，修正为8后复验 `10/10 PASS`。随后补强刷新恢复、非法日期 stale 和面板关闭语义，只复验直接受影响的 m2 `10/10` 与 m100 `13/13 PASS`；最终 source/snapshot `52f3aaa2…bfcb`，4173 listener 不变，均退出0；未运行 full
- 架构与数据风险：服务端只接受当前 owner 可读且 storage ready 的图片、已发布/启用/未归档且 `mediaInputPolicy=seedance-2` 的视频模型，并复用模型 `referenceMediaRules` 校验类型、字节、尺寸和比例。结果绑定 asset/model/role、模型配置 revision、checkedAt/expiresAt；过期、asset/model/role/规则版本任一漂移均 stale。结果保存到 Canvas 节点元数据，不包含签名 URL、密钥或视频任务身份
- 设计偏差：ByteDance 当前没有本 Goal 可安全调用的官方远端“素材资格校验”接口，因此严格实现五分钟本地技术预检，并在 DTO/UI 固定 `remoteValidationAvailable=false`、`scope=local-technical-preflight`；不生成视频，不声明远端可生成、质量或法律合规。D11 同时纠正 D10 已实现但 capability registry 仍误报不可用的保守增强/主体抠图，以及 Seedance 本地校验操作状态
- 阻断：无；主方案明确没有官方远端资格接口不构成阻断
- 回滚点：D10提交`2a30be84dad83bee70474135fd8b1e6df6600176`
- 唯一下一动作：提交 D11 本地 checkpoint commit；随后先把 D12 标为 `IN_PROGRESS`，冻结 v0.6.34 候选并执行统一验证

## 23. D10 增强与主体抠图

- 时间：2026-08-23 22:32:26 +0800
- 阶段：`D10`
- 状态：`TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `f8a783d8dfcfe1553bae7315fe2ba008f843fed0` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D9 已提交为 `f8a783d`；D10 未提交树完成三项真实路径：保守增强走本地安全读取和派生媒体，创意增强/主体抠图走独立operation与既有Generation生命周期；未进入 D11
- 产品文件：`types/imageTools.ts`、`ProbeNode.tsx`、`localImageProcessing.ts`、`derivedImageToolUseCase.ts`、`promptGenerationImageToolUseCase.ts`、`ImageNode.tsx`、`styles.css`、`assetStorage.ts`、`generationTasks.ts`、`relayProviderAdapters.ts`
- 测试文件：`m100-modular-ports.spec.ts`、`m2-image-node.spec.ts`、`m27-node-inputs.spec.ts`、`m53-relay-provider-adapters.spec.ts`、`m57-relay-generation-runtime.spec.ts`
- 文档文件：本Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`、主方案偏差段
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本`v0.6.34`
- 外部请求和付费预算：总计`0/8`；真实Provider/OSS、GitHub/SSH/生产写入均0
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。D10 首轮 m100+m53 `38/38 PASS`；m2+m27 `30/30 PASS`；补强保守增强真实派生、棋盘格和任务结果 Alpha 门后最终 m2+m57 `26/26 PASS`。最终 source/snapshot `790089b4…cffc`，4173 listener不变，均退出0；未运行full
- 架构与数据风险：保守增强只在浏览器安全像素链做同尺寸轻量对比度/色彩校正并生成派生PNG，不创建Generation任务；创意增强明示会改变内容并使用独立operation。主体抠图的Canvas/task都持久化`outputBackground=transparent`，GPT Image请求显式发送`background=transparent`，同步/异步/下载归一化后的每条结果在保存前解码PNG滤波行并要求至少一个真实非不透明Alpha样本；丢Alpha或任务身份缺失统一fail-closed，不把棋盘格烘焙进图片
- 设计偏差：不引入许可证未闭环的rembg权重或第二套图片任务系统。保守增强采用本地确定性轻量校正，创意增强与主体抠图复用现有GPT Image edit生命周期；真Provider技术冒烟继续放到D13精确v0.6.34候选
- 阻断：无；自动证据不等于真实Provider、生产或用户质量验收
- 回滚点：D9提交`f8a783d8dfcfe1553bae7315fe2ba008f843fed0`
- 唯一下一动作：提交 D10 本地 checkpoint commit；随后进入 D11 前先把 D11 标为 `IN_PROGRESS`，只施工 Seedance 素材校验，不生成视频

## 22. D9 扩图与擦除

- 时间：2026-08-23 22:12:56 +0800
- 阶段：`D9`
- 状态：`TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `5c7401b3a8c2a0e781fa892eaa3019158056490b` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D9 未提交树已完成 outpaint/erase 两项独立操作；未进入 D10
- 产品文件：`types/imageTools.ts`、`persistedMediaSources.ts`、`ProbeNode.tsx`、`localImageProcessing.ts`、`outpaintEraseImageToolUseCase.ts`、`ImageNode.tsx`、`styles.css`、`server/generationTasks.ts`、`server/mediaIntegrity.ts`
- 测试文件：`m100-modular-ports.spec.ts`、`m2-image-node.spec.ts`、`m27-node-inputs.spec.ts`、`m88-media-publication.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`、主方案偏差段
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`、重绘 `0/1`、扩图 `0/1`、擦除 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。首轮 m100 `13/13 PASS`；m2 首轮唯一失败为更多菜单可用按钮旧计数，产品其余9项通过；补齐两项入口/禁用提交/零请求断言后 m2+m27 `30/30 PASS`；最终 m100+m88 `49/49 PASS`。最终 source/snapshot `6c634191…465c0`，4173 listener不变，均退出0；未运行 full
- 架构与数据风险：outpaint由安全读取链生成扩展透明PNG与同尺寸mask，原图区域不缩放；边界、准备资产和遮罩持久化后由服务端按owner/PNG/尺寸/源图严格核验，Provider只接收准备输入。erase复用遮罩UI但保持独立operation、ownership、占位前缀和任务身份。两项均先保存Canvas占位并完成Media adoption，再允许既有Generation admission
- 设计偏差：扩图UI采用四周等比5%～50%的全屏边界预览，强制只扩大不裁小/不拉伸；真实Provider质量与原图保持留到精确v0.6.34候选D13各一次预算内冒烟及后续用户复验
- 阻断：无；自动证据不等于真实Provider、生产或用户质量验收
- 回滚点：D8 提交 `5c7401b3a8c2a0e781fa892eaa3019158056490b`；D9 无schema、真实Provider/OSS、GitHub或生产写入
- 唯一下一动作：提交 D9 本地 checkpoint commit；随后进入 D10 前先把 D10 标为 `IN_PROGRESS`

## 21. D8 遮罩基础与重绘

- 时间：2026-08-23 21:59:48 +0800
- 阶段：`D8`
- 状态：`TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `6f9ace9` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D8 未提交树已完成像素级遮罩、owner-scoped遮罩媒体、重绘派生占位、持久任务、GPT Image mask发送、重试/恢复和Media引用保护；尚未进入 D9
- 产品文件：`types/imageTools.ts`、`types/persistedMediaSources.ts`、`client/src/imageTools/redrawMask.ts`、`redrawImageToolUseCase.ts`、`client/src/canvas/ProbeNode.tsx`、`ImageNode.tsx`、`client/src/generation/generationTasks.ts`、`client/src/styles.css`、`server/inputPreflight.ts`、`generationTasks.ts`、`generationTasksApi.ts`、`mediaIntegrity.ts`、`relayProviderAdapters.ts`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`m2-image-node.spec.ts`、`m27-node-inputs.spec.ts`、`m53-relay-provider-adapters.spec.ts`、`m88-media-publication.spec.ts`；另复用未改 m5/m87 直接依赖回归
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`、重绘 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 `node scripts/run-safe-tests.mjs run --spec ...`。最终有效证据：m100 `13/13`、m2 `10/10`、m27 `20/20`、m53 `25/25`、m88 `36/36`、m5+m87 `29/29 PASS`，均退出0；m100首轮暴露组件props/ownership类型错误，m27调试期依次修正可用性期望和严格400响应期望，m2移除不成立的fake GET轮询假设，m88加强mask临时OSS断言首轮由测试fake形参类型错误在产品测试前失败，均只修根因并复验最小范围。最终 source/snapshot：m2与m5+m87为`d2505a85…593c1`，m88加强后为`cdbeb506…0b5e3`；4173 listener均不变；未运行 full
- 架构与数据风险：遮罩最大4 MiB、PNG、单边8192、总像素4000万、羽化0～64；Canvas只保存assetId/尺寸/版本/feather，不保存Base64或签名URL。Canvas占位使遮罩成为durable Media引用；服务端再按owner、ready、content-type、尺寸和已保存节点身份校验。Provider临时OSS对象在提交链finally精确清理；已付费结果回填失败继续由既有task/media和重新挂接路径承接，不盲删结果
- 设计偏差：产品冻结范围明确不支持任意自由旋转，Canvas也没有图片节点旋转状态，因此没有发明旋转变换；屏幕固定编辑器天然不随Canvas缩放，m100用1280×720原图映射到640×360 CSS框并验证越界夹取，覆盖缩放和高DPI坐标。主方案要求的真实冒烟与D7同理统一延后到D13精确v0.6.34候选，避免提前SSH或拿v0.6.33普通生成冒充新代码证据
- 阻断：无；自动证据不等于真实Provider、生产或用户质量验收
- 回滚点：D7 提交 `6f9ace9`；本阶段无schema、真实Provider/OSS、GitHub或生产写入
- 唯一下一动作：提交 D8 本地 checkpoint commit；随后进入 D9 前先把 D9 标为 `IN_PROGRESS`，只施工扩图与擦除，不提前进入 D10

## 20. D7 多角度完成记录

- 时间：2026-08-23 21:30:34 +0800
- 阶段：`D7`
- 状态：`TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13 / USER_QUALITY_RECHECK`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `7a161da9f2cb862fc2e7e6898c5b51de56335258` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D7 未提交树已完成结构化多角度任务、内部 model identity 修正、占位持久屏障、task binding 和 fake UI/端口证据；未进入 D8
- 产品文件：`types/imageTools.ts`、`client/src/canvas/ProbeNode.tsx`、`ImageNode.tsx`、`client/src/generation/imageGenerationAdapter.ts`、`singleNodeGenerationLifecycle.ts`、`client/src/imageTools/generationImageToolUseCase.ts`、`multiAngleImageToolUseCase.ts`、`client/src/styles.css`、`server/generationApplicationApi.ts`、`server/imageToolCapabilityRegistry.ts`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`。真实请求仍未消费
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 `node scripts/run-safe-tests.mjs run --spec ...`。m100+m2 合并执行时 m100 `13/13` 且新增多角度用例通过，m2 后续两个既有用例因测试删除共享 fixture 后未恢复而形成 `8/10`；加入 multi-angle 专属 `afterEach` 清理后只复验受影响 m2，退出 0、`10/10 PASS`，source/snapshot `1696804d…b79b`，4173 listener 不变。未运行 full
- 架构与数据风险：结构化参数、唯一 operationId、source asset/node、account/canvas、model/参数、prompt/质量共同构成 ownership；任何来源或语义变化均 fail-closed。派生占位先通过 Canvas fence 创建并保存，再允许持久 task admission；task 绑定后现有 ImageNode lifecycle 继续拥有恢复、取消、重试、终态 Media 回填和已付费结果重新挂接。ImageNode 没有新增 fetch、Provider 分支或轮询；通用 adapter 从组件抽到 generation 模块以避免复制
- 设计偏差：主方案原写 D7 fake 后立即真实冒烟，但 Goal 同时明确 GitHub/SSH/生产运行须等 D12。当前本机没有可安全使用且不读取禁区数据的专用真实 profile；因此不提前 SSH、不读取 `app/data`、不拿 v0.6.33 的普通图片生成冒充新代码证据。所有生成式操作的真实技术冒烟统一放到 D13 精确 v0.6.34 候选的隔离 staging/生产门执行，届时仍逐项受预算和未知计费禁止重试约束
- 阻断：无；这是授权顺序下的证据延后，不是能力缺失。自动证据不等于真实 Provider、生产或用户质量验收
- 回滚点：D6 提交 `7a161da9f2cb862fc2e7e6898c5b51de56335258`；本阶段无 schema、Provider、真实 OSS、GitHub 或生产写入
- 唯一下一动作：提交 D7 本地 checkpoint commit；随后进入 D8 前先把 D8 标为 `IN_PROGRESS`

## 19. D7 多角度

- 时间：2026-08-23 21:01:29 +0800
- 阶段：`D7`
- 状态：`IN_PROGRESS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `7a161da9f2cb862fc2e7e6898c5b51de56335258` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D6 已提交为 `7a161da`，提交后工作树 clean；D7 仅写入阶段开始断点，尚无 D7 产品或测试改动
- 产品文件：待复用 `generationImageToolUseCase`、`singleNodeGenerationLifecycle` 和现有多角度面板后按最小范围冻结
- 测试文件：先扩既有 m100/m2 fake 和零请求证据，再决定真实技术冒烟最小路径
- 文档文件：本 Checkpoint
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：多角度 `0/1`，总计 `0/8`；真实 OSS `0`；GitHub/SSH/生产写入 `0`。fake 与零请求门通过前禁止真实提交
- 测试命令、环境、结果、退出码：复用未变 D6 commit 的 m100+m2 `23/23 PASS` 与 m20 `1/1 PASS`；D7 尚未运行测试，不重复 full
- 架构与数据风险：多角度必须进入现有持久任务、attempt、恢复、幂等、成本和 ownership 栅栏；结构化水平/垂直/距离/广角不得只拼一段无身份提示词后伪装成独立能力；结果保留原图并生成派生节点
- 设计偏差：待施工
- 阻断：无；当前生产能力快照已确认 GPT Image 2 编辑协议可用，但真实请求必须等 fake/零请求通过且付费状态可判断
- 回滚点：D6 提交 `7a161da9f2cb862fc2e7e6898c5b51de56335258`；本阶段尚无 Provider、OSS、schema 或生产写入
- 唯一下一动作：实现多角度结构化任务与完整生命周期，先完成 fake/零请求验证，不得进入 D8

## 18. D6 真实模型和处理引擎调查

- 时间：2026-08-23 20:58:06 +0800
- 阶段：`D6`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `6c6e0c32d8974568ea813201a3d9570dfbc45c8a` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D5 已提交为 `6c6e0c3`；D6 未提交树新增服务端 operation 能力注册/快照/API、Generation 安全查询、composition/Vite 路由、OpenAPI 和客户端 capability Context，ImageNode 只消费 DTO；未进入 D7 功能执行
- 产品文件：`server/imageToolCapabilityRegistry.ts`、`imageToolApplicationApi.ts`、`generationApplicationApi.ts`、`applicationComposition.ts`、`openApi.ts`、`vite.config.ts`、`client/src/imageTools/ImageToolCapabilityContext.tsx`、`CanvasShell.tsx`、`ImageNode.tsx`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m20-api-contract.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH写入和生产写入 `0`。生产管理页只读确认默认图片模型为优创 `gpt-image-2` / GPT Image 协议、全局真实生成开启且紧急停止关闭；一次“读取余额/用量”诊断明确未创建生成任务。Ark SSO 到期后按登录流程刷新，价格只读确认 Seedream 5.0 Lite/4.5/4.0 当前账号单价分别为 CNY `0.22/0.25/0.20` 每图，未创建资源或任务
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 safe runner。m100 首轮先暴露 TypeScript tuple 窄化，修复后第二轮仅旧组合根精确计数 7 未随新增应用 API 改为 8，最小复验最终 `13/13 PASS`；m20 `1/1 PASS`；m2 首轮前 7 项通过后因能力服务在 fixture 中正确返回管理员停用而旧面板入口被禁用，主动中止退出 130，改为“入口可查看参数、实际提交再按 capability fail-closed”后最终 `10/10 PASS`。客户端增加精确过期定时 fail-closed 后，合并复验 m100+m2 `23/23 PASS`、退出 0，最终 source/snapshot `ff928f42…1cfb`，4173 listener 不变；未运行 full
- 架构与数据风险：服务端是五态、单项停用和过期的唯一权威，客户端失败即 stale；DTO 不含凭据、余额或 Provider 配置。官方 GPT Image 2 文档确认 edits、参考图、mask、高保真输入和透明 PNG/WebP；mask 与输入需同格式同尺寸且小于 50 MiB，产品继续采用更严的 20 MiB/4000 万像素界限。ByteDance 官方 Seedream 资料确认单/多参考图编辑，但未核实独立 mask API，因此不为其声明 mask。Real-ESRGAN 代码为 BSD-3-Clause但生产资源成本未冻结；rembg 本体虽 MIT，其模型权重许可证分离且 BRIA 商用另需授权，并存在旧版路径穿越修复边界，当前不引入
- 设计偏差：没有为每个按钮硬编码 Provider 名或把生产余额下发浏览器；只注册一个 `gpt-image-edit` 能力适配器并由当前账号安全模型查询决定可用性。多角度/重绘入口即使 Provider 暂停仍可打开查看本地参数，真正提交由后续阶段按 capability 拒绝，既保留既有面板合同也不伪造可生成。D10 主体抠图优先复用已核实的 GPT Image 透明输出，不捆绑许可证未闭环的 rembg 权重
- 阻断：无。`agent-reach` 的 Exa MCP 和本机 `agent-reach` CLI 均不可用，但已按失败链改用 OpenAI、ByteDance、Volc、rembg、Real-ESRGAN 官方一手页面和生产只读管理页完成交叉核实；这不影响已冻结能力合同
- 回滚点：D5 提交 `6c6e0c32d8974568ea813201a3d9570dfbc45c8a`；D6 没有 schema、Provider任务、OSS、GitHub 或生产写入
- 唯一下一动作：提交 D6 本地 checkpoint commit；随后进入 D7 前先把 D7 标为 `IN_PROGRESS`，只施工多角度结构化生成与恢复，不提前进入 D8

## 17. D5 个人素材库

- 时间：2026-08-23 20:38:01 +0800
- 阶段：`D5`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `fb0f3eba6c1ea5c7f4785367be864dd277413aa5` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D4 已提交；D5 未提交树完成真实个人素材库、主库/sidecar 锁序、Media 删除保护、备份/恢复、账号清理、OpenAPI、图片工具栏保存和素材面板真实数据；尚未进入 D6
- 产品文件：`server/library/internal/libraryStore.ts`、`libraryCatalog.ts`、`libraryApplicationApi.ts`、`libraryBackup.ts`、`mediaLibraryReferencePort.ts`、`mediaApplicationApi.ts`、`accountTransactionCommands.ts`、`auth.ts`、`applicationComposition.ts`、`backupPackage.ts`、`openApi.ts`、`vite.config.ts`、`client/src/imageTools/saveLibraryAssetUseCase.ts`、`ImageNode.tsx`、`CanvasShell.tsx`、`styles.css`、架构边界
- 测试文件：`tests/m10-backup.spec.ts`、`m11-auth.spec.ts`、`m2-image-node.spec.ts`、`m20-api-contract.spec.ts`、`m25-library-contract.spec.ts`、`m8-assets-drag.spec.ts`、source coverage manifest
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：统一使用 pinned Node `22.23.1`、npm `10.9.8` 和 `node scripts/run-safe-tests.mjs run --spec ...`；m10 `17/17`、m11 `8/8`、m2 `10/10`、m20 `1/1`、m25 `2/2`、m8 `1/1`、m88 `36/36` 均退出 0。m8 首轮因测试对不存在媒体先 DELETE 建立安全墓碑而上传 409，移除错误预清理后最小复验通过；m20 首轮只因 OpenAPI 新增 1 路径/2 操作后旧 UI 精确计数 23/32 未同步而失败，同步为 24/34 后最小复验通过。最终受影响代码复验 m25 source/snapshot `ee3b21b4…9de8`，4173 listener 不变
- 架构与数据风险：主库继续精确 schema39；Library 独立 sidecar schema1、0600、拒绝符号链接/非常规文件/不可信权限，固定锁序为主库后 Library。保存先验证 owner/ready/delete intent，再建立 durable Media 引用和幂等 Library 行；删除条目只解除 Library 引用，实际媒体删除仍由 Media 管；项目/节点删除不触碰 Library，账号删除在 claim 后先清 Library 再物理媒体清理。两库无法原子提交时只允许“主库保留安全引用但 Library 行未提交”的可重试安全泄漏，不允许悬空 Library 行
- 设计偏差：没有给主库升 schema40，因为当前精确 schema39 门会使 v0.6.33 回滚启动失败；改用旧 release 完全忽略的独立 `library.sqlite`。备份格式增加可选加密 `library` entry，旧备份没有 sidecar 仍兼容。精确 D4 commit `fb0f3eba…` 的 v0.6.33 数据层已在临时 schema39 主库旁存在真实 schema1 sidecar 时打开并 `quick_check=ok`
- 阻断：无；自动证据不等于生产或用户验收，D5 未运行 full，未访问真实 Provider/OSS/生产
- 回滚点：D4 提交 `fb0f3eba6c1ea5c7f4785367be864dd277413aa5`；主库仍为 schema39，新增 sidecar 仅在测试临时数据中创建；本阶段无 Provider、真实 OSS 或生产写入
- 唯一下一动作：提交 D5 本地 checkpoint commit；随后进入 D6 前先把 D6 标为 `IN_PROGRESS`，按官方资料核实真实模型和处理引擎

## 16. D4 标注与显式导出

- 时间：2026-08-23 20:02:36 +0800
- 阶段：`D4`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `0d0c0a4f58c5075b650ada8df1bd48626076f5b8` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：D3 已提交；D4 未提交树已加入版本化矢量标注文档、选择/画笔/矩形/箭头/编号/中文文字/删除/会话撤销重做/路径简化、刷新恢复和显式导出，未进入 D5
- 产品文件：`types/imageTools.ts`、`client/src/imageTools/imageAnnotations.ts`、`renderAnnotatedImage.ts`、`ImageAnnotationEditor.tsx`、`client/src/canvas/ProbeNode.tsx`、`ImageNode.tsx`、`client/src/styles.css`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：pinned Node `22.23.1`、npm `10.9.8`；容量实验使用 100 个矩形、1 条 1000 点画笔和中文文字，共 102 个元素，JSON `29,460` bytes（512 KiB 上限的 `5.62%`），1000 次 stringify `61.476ms`、1000 次 structuredClone `200.448ms`，退出 0。`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 调试期先后暴露 SVG 空白点击未稳定命中及 IME composition 状态缺口；只修根因并复验，最终退出 0、`10/10 PASS`。`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 退出 0、`13/13 PASS`；最终 source/snapshot `c2a4a5e1…b85d`，4173 listener 不变
- 架构与数据风险：容量实验支持把版本化矢量文档保存在 Canvas 节点元数据；实现仍强制 500 元素、单路径 2000 点、总点数 20000 和 512 KiB，上屏路径结束时简化。标注不改原图，只有显式导出才走 owner-scoped 同站安全源并生成派生资产；中文文字和路径简化不得丢失
- 设计偏差：容量结果支持直接使用 Canvas 元数据，没有建立独立标注资产；单击编号/文字改由 SVG `click` 提交，拖拽工具继续使用 pointer capture，避免空白 SVG 命中差异；中文输入明确记录 composition 状态
- 阻断：无；自动证据不等于生产或用户验收
- 回滚点：D3 提交 `0d0c0a4f58c5075b650ada8df1bd48626076f5b8`；本阶段无 Provider、OSS、schema 或生产写入
- 唯一下一动作：提交 D4 本地 checkpoint commit，然后进入 D5 前先把 D5 标为 `IN_PROGRESS`

## 15. D3 颜色标记、调整像素、快速分割

- 时间：2026-08-23 19:45:13 +0800
- 阶段：`D3`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / `9b33114047862d375a0dd288cd44dae0b4750965` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：颜色标记写入节点元数据并进入 Canvas 自动保存/历史，筛选只隐藏不匹配图片及相连边；像素调整复用同站安全编辑源并生成 PNG 派生节点；快速分割先完整生成 4/9/16 个 PNG，再登记媒体并以单一 Canvas command 提交全部 node+edge，任一失败精确 discard 本批资产
- 产品文件：`client/src/canvas/CanvasGraphMutationContext.ts`、`CanvasSurface.tsx`、`ImageNode.tsx`、`ProbeNode.tsx`、`client/src/styles.css`、`client/src/imageTools/LocalImageToolPanels.tsx`、`batchDerivedImageToolUseCase.ts`、`localImageProcessing.ts`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`tests/m2-image-node.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；GitHub/SSH/生产操作 `0`
- 测试命令、环境、结果、退出码：pinned Node `22.23.1`、npm `10.9.8`；`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 最终退出 0、`13/13 PASS`，覆盖 2/3/4 网格批量原子提交和 stale 后 4 资产精确补偿；`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 最终退出 0、`10/10 PASS`，覆盖标记保存/筛选/撤销/刷新、640×360 像素派生、2×2 四节点持久落图、3×3/4×4 入口和零生成请求。调试期首轮 m100 由缺少媒体宽高类型失败；m2 两轮分别发现裁剪既有错误文案漂移和 React Flow 虚拟化导致的 DOM 计数假设，均只修复根因/测试观测并复验 m2；最终 source/snapshot `f9e65bc9…ba04` 不变，4173 listener 不变
- 架构与数据风险：本地工具未创建 Generation task；输入/输出继续受 20 MiB、4000 万像素和单边 8192 限制；批量提交 fence 绑定 revision/source/operation/run/ownership。页面只会渲染视口内节点，因此完整 4/9/16 数量由持久 Canvas 和端口原子测试证明，不用 DOM 虚拟化数量冒充数据量
- 设计偏差：断点在压缩前未先切到 D3 `IN_PROGRESS` 即已有 D3 初稿；恢复后先暂停编辑并补正真实断点。为不增加测试总数，D3 断言并入既有 m100/m2，用持久 Canvas 观测替代视口 DOM 总数
- 阻断：无；HEAD、origin/main、package、版本门和发布门均未漂移，受保护文件不在本 worktree
- 回滚点：D2 提交 `9b33114047862d375a0dd288cd44dae0b4750965`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D4，先把 D4 标为 `IN_PROGRESS`，完成标注容量实验并冻结存储方案

## 12. D0 实时基线和文档恢复

- 时间：2026-08-23 19:15:37 +0800
- 阶段：`D0`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：写入前为 `main` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：启动分支 `6a1606c` 已显式提交 18 个治理文档；受保护 JSON 未暂存且只保留在原工作树；隔离 worktree 创建后为 clean，产品代码差异为 0
- 产品文件：无
- 测试文件：无；发现现有 `m2-image-node` 已覆盖多角度占位参数与重绘本地遮罩取消语义，后续只扩展不把占位证据冒充真实能力
- 文档文件：现有 v0.6.33 状态对齐文档与 INC-IMGEDIT-003 三份合同文档；受保护 JSON 不在施工范围
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；OSS 测试对象 `0`；本阶段只有生产只读 GET 探针，无写请求
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；D0 为文档和只读恢复阶段，未执行产品测试；`git diff --cached --check` 退出 0；生产 `/api/version`、`/api/health/live`、`/api/health/ready` 三个只读 GET 均退出 0，返回 `0.6.33 / live / ready active schema39`
- 架构与数据风险：现有 Provider 支持 Ark、OpenRouter、OpenAI-compatible 和 multi-protocol relay，图片 relay 已有 `generation/edit` 端点边界；Storage 已有 local/OSS `MediaBlobStore`、owner-scoped 读取、profile 路由与有界 PNG 校验。尚无 INC-IMGEDIT-003 操作级权威状态，也不能把现有普通 edit 直接宣称为 mask/outpaint/erase/Alpha 能力
- 设计偏差：无；已采用“启动分支承接现有文档 → 干净隔离 worktree 继续”的恢复路径，未读取任何 profile 密钥或受保护文件
- 阻断：无；分支、版本门、发布门、生产探针和工具链均有效
- 回滚点：`origin/main@14777b5dc5cf48de8b21b6eb3ee27da45070b537` 与文档启动提交 `6a1606cdafd3b38c1333ca6c46baecfae690bd35`；原工作树和受保护文件保持原位
- 唯一下一动作：进入 D1，先在本文件把 D1 标为 `IN_PROGRESS`

## 13. D1 合同、矩阵和架构门

- 时间：2026-08-23 19:22:23 +0800
- 阶段：`D1`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `43ccd32fdf674724d96dcc84f6739c101bac05f2` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：新增共享图片工具合同；扩展架构域与 Library 未来表所有权；扩展 m100 两个合同测试；安全测试总清单由 1050 精确同步为 1052，source coverage manifest 同步
- 产品文件：`types/imageTools.ts`、`scripts/architecture-boundaries.json`
- 测试文件：`tests/m100-modular-ports.spec.ts`、`scripts/run-safe-tests.mjs`、`scripts/source-coverage-manifest.json`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本仍为 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；测试网络只允许动态 loopback
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；`node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 首次在 TypeScript 收窄处失败、修复后发现精确测试清单需同步为 1052；同步 runner 与 source coverage manifest 后最小复验退出 0，m100 `13/13 PASS`，架构 `76` 个既有例外且新增例外 `0`，TypeScript/build/source coverage/网络门均通过，source/snapshot `028ad751...` 不变，4173 listener 不变
- 架构与数据风险：operation、result、capability、状态、失败码、owner/revision/run/task 身份均已冻结；input/mask/annotation 有界，Library 表预分配独立 owner。尚未实现权威服务或 Dispatcher，因此 `IMGEDIT-010～020` 仍为 `NOT_STARTED`
- 设计偏差：没有新建 m101 文件，两个合同测试并入现有模块化端口 m100；为维持安全 runner 的精确清单，同步 1052 与三个行为目标 SHA
- 阻断：无
- 回滚点：阶段起点 `43ccd32fdf674724d96dcc84f6739c101bac05f2`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D2，先把 D2 标为 `IN_PROGRESS`

## 14. D2 最小图片工具应用层

- 时间：2026-08-23 19:29:05 +0800
- 阶段：`D2`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-003-v0.6.34-2026-08-23` / 阶段起点 `6cbd2e2bdf675853ae14c96f44bf2eac979f742b` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 工作树摘要：新增轻量 Dispatcher、派生图片 use case、viewer use cases 和对既有 single-node Generation lifecycle 的薄适配；CanvasGraphCommandPort 增加 image-tool 原子 fence；裁剪改为媒体登记后一次原子提交 node+edge，失败精确 discard
- 产品文件：`client/src/imageTools/imageToolDispatcher.ts`、`derivedImageToolUseCase.ts`、`viewerImageToolUseCases.ts`、`generationImageToolUseCase.ts`、`client/src/canvas/canvasPorts.ts`、`client/src/canvas/ImageNode.tsx`
- 测试文件：`tests/m100-modular-ports.spec.ts`
- 文档文件：本 Checkpoint、`UNBOUNDRY_ACCEPTANCE_MATRIX.md`、`TASKS.md`
- package / schema / candidate：`0.6.33 / schema39 / 无候选`；目标版本 `v0.6.34`
- 外部请求和付费预算：Provider `0/8`；真实 OSS `0`；m100 fake media/fake Generation，m2 仅临时本地媒体和动态 loopback
- 测试命令、环境、结果、退出码：Node `22.23.1`、npm `10.9.8`；m100 首轮 TypeScript 因测试 fake 未收窄 union 失败，修复后 `node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts` 退出 0、`13/13 PASS`；`node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts` 退出 0、`10/10 PASS`；最终 m100 最小复验在 Generation 薄适配加入后仍 `13/13 PASS`。各次架构新增例外 0，TypeScript/build/source coverage/网络门通过；最终 source/snapshot `8ed05373...` 不变，4173 listener 不变
- 架构与数据风险：ImageNode 未新增 fetch、Provider 分支或轮询；Dispatcher 只做 operation→use case 路由；派生提交使用 revision+sourceAssetId+runId+ownershipKey fence；Generation 复用现有 SingleNodeGenerationLifecycle，没有第二套任务系统。操作级服务端权威状态将在 D6 完成，因此 IMGEDIT-010 暂记 `PARTIAL`
- 设计偏差：把原裁剪 node 与 edge 两步 React 写入收口为 CanvasGraphCommandPort 一次提交；下载和全屏通过 viewer use cases，行为和 UI 不变
- 阻断：无
- 回滚点：阶段起点 `6cbd2e2bdf675853ae14c96f44bf2eac979f742b`；本阶段无 schema、Provider、OSS 或生产写入
- 唯一下一动作：进入 D3，先把 D3 标为 `IN_PROGRESS`

## 11. PRE_GOAL 文档落档记录

- 日期：2026-08-23
- 范围：只落主方案、Checkpoint、Goal 提示词，并同步 TASKS、CURRENT_STATE 和验收矩阵；产品代码、测试、schema、package、Provider、OSS、GitHub和生产均未改变
- Git：`main` / HEAD 与 `origin/main` 均为 `14777b5dc5cf48de8b21b6eb3ee27da45070b537`
- 静态验证：`git diff --check`，退出码 0
- 定向测试尝试：Node `22.23.1` / npm `10.9.8`，`node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`，退出码 1；safe preflight 和架构检查先通过，随后在运行 m38 前因 main 既有 ignored `backups/` 目录的 direct-write 负控返回 `EISDIR` 而停止；产品测试执行数 0，source snapshot 与 4173 listener 均未变化
- 结论：这是既有测试隔离环境阻断，不是文档断言失败；本轮不绕过 safe runner、不删除用户备份、不重复 full，也不把本次尝试写成测试 PASS
- 受保护文件：`spec/public-templates-director-split-revision.json` 保持未读、未改、未暂存
- 唯一下一动作：仍是新 Goal 的 D0；在安全隔离 worktree 先恢复实时基线，再按风险执行当阶段最小测试
