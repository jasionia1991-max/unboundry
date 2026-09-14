# 视频查询与工作流恢复：第 2 版施工方案

角色：`TASK_PLAN`。任务 `VIDEO-QUERY-WORKFLOW-RECOVERY-20260913`。当前为方案补齐与复审，未实施、未验收、未上线。授权与断点由 [TASKS](../TASKS.md) 拥有。产品规则由 [生成合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.3～2.5、3～3.2及 [UI合同](UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9 拥有；本方案不以新日期覆盖旧合同。

## 1. 核实依据与目标

代码基线：`300e3e891d87f3d294a4be24b780a07b315bee2a`，分支 `codex/v0720-production-receipt`，产品 v0.7.20 / schema44。9月13日本会话只读检查曾核对生产四个相关源文件与本地哈希相同；该观察不是以后执行时的新鲜生产证明。底层配置锁异常的原始原因未被日志保留，不能指认锁持有者或断言一定是数据库竞争。

本次事故身份（不可沿用上一轮下载超时事故的操作单）：

- canvas `5ef21c1a-14c9-4c90-8d2a-f42338668c4f`，run `04052d0e-6cc8-4df2-8d06-89b20b321fcb`。
- node `video-08b256b8-cf04-4f8e-b8af-91287faf7501`，task `c28aa7cc-e8c5-420c-ac8f-e1529c36d159`。
- execution attempt 1，Provider attempt 1187，远端任务 `135893903`。
- 北京时间21:53:37日志为 `ProviderProfileLockBusyError / RESULT_DELAYED`；21:56:15原任务已 success，原结果资产 `238bc178-1013-407d-ba97-6b5b9e4d8d67.mp4` 已保存（17,341,252字节）。当次检查时 run/node 仍 failed，Canvas未回填，下游未准入。

目标：今后的合格原请求在临时故障后沿原 task/attempt 自动恢复、显示并推进原活动工作流；当前历史事故只同步已有结果，历史下游另经受保护的后继准入。禁止把“task success”或健康接口当作整条用户流程完成。

## 2. 对第 1 版的修正

| 审计缺口 | 第2版决策 |
| --- | --- |
| 只补轮询重试，循环结束仍 failed | 补轮询退出到持久恢复的交接、重启接管、期限及终态判定；工作流不消费“临时错误=失败” |
| 获取锁的一切错误被包装成锁忙 | 只把已识别的锁竞争分类为 transient；保存安全的原始原因及阶段，其他异常不伪装成锁忙 |
| 直接套用旧A/B/C采用工具 | 新增独立内部“成功原结果同步”命令；不调用旧 adoption、不伪造其回执、不重新结算任务 |
| 旧续跑不接受 failed node 的普通 success task | 通过精确成功投影收据认可该原结果，冻结为后继输入；原run/node历史不变 |
| 回退含糊 | 固定schema44，无DDL迁移；候选→当前schema只读维护桥→候选，桥上不能继续使用产品 |

代码依据：`server/providerProfiles.ts` 的锁获取包装；`server/generationTasks.ts` 的 `isTransientRelayPollError`、`executeVideoTask`、`executeRelayMediaTask` 退出处理；`server/workflowRunService.ts` 的 `processWorkflowRun`、`runWorkflowSweepPass`、`frozenTaskSource`；`server/generationResultAdoptionApplication.ts` 的失败格式事故/三条发布记录/已有采用回执门；`server/database.ts` schema43～44已有状态和收据表。

## 3. 查询恢复与活动工作流

### 3.1 请求边界及错误分类

同一错误必须结合持久 Provider attempt 的请求阶段判断，不能只按错误文案或是否有远端ID决定重发。

| 持久事实 | 允许动作 | 禁止动作 |
| --- | --- | --- |
| 已证明尚未调用平台提交，且无其他未决attempt | 原意图有限等待后重新检查配置、取消和提交围栏 | 以“没有taskId”推断没有提交 |
| 原请求有匹配远端ID，尚无真实终态 | 查询原ID、找回原结果，遇已知锁竞争退避 | 再次POST生成、换模型/凭据绕开原身份 |
| 请求可能受理但结果未知、ID缺失或证据冲突 | 保留未知付费保护，沿现有有界核对/维护机制 | 为解卡新建付费请求或宣布未扣费 |
| 原结果已保存、任务成功 | 仅结算工作流/同步Canvas | 重下载重发布替代已有效结果、重生成 |
| 真实平台失败/退款或用户取消 | 沿已有终态、手动新意图及一次补偿合同 | 由本修复增加补偿次数、复活取消任务 |

锁获取保留原有文件权限校验及跨进程锁，不移除锁、不跨网络请求持锁、不延长到整个视频生成过程。识别SQLite已知BUSY/LOCKED及明确锁竞争；权限、路径、完整性/配置错误单独诊断。诊断保留异常类型、阶段、安全cause code及关联ID，不落凭据、完整响应、提示词和签名URL。非暂时本地错误发生在提交后，也不构成平台失败或无扣费证据：转待处理并保护原请求。

### 3.2 持久交接与停止规则

- 本节“合格活动请求”精确定义为：现代完整身份的 `media-generate` 视频task，绑定仍为running的run及admitted节点，未stop/cancel，原attempt已持久记录匹配远端ID和accepted/response-received证据。该资格每次按数据库事实核验，不按部署日期、错误文案或客户端字段猜测。已在正常运行且满足这些条件的旧请求也可安全交接；历史failed run不适用。无ID/未知付费分支仍沿既有保留证据与工作流收口规则，不将其自动扩展成无限等待；其他协议/单节点/一次退款补偿策略不借此改写。共享错误分类改动仍必须回归其调用者。
- 复用已有 task `running → recovering → running` 状态，不增加终态枚举，不把 `RESULT_DELAYED` 写成最终 failed。由 task-store 的原子条件更新检查 task/attempt、请求身份、取消及runtime所有权，并写事件；不能只改内存标记。现有历史 failed 记录不借此批量转 recovering。
- 轮询内部短暂恢复沿用原冻结策略；前台轮询退出时，只要原请求仍可恢复，持久交给现有恢复worker，释放前台执行资源。交接记录提交失败不得先把任务记failed；保留原状态，由启动扫描在确认旧runtime已退出后接管。
- 恢复调度使用原attempt开始时间及冻结期限，刷新、重启和重试不能刷新总预算；原请求核对/原结果保存分别沿用已有期限。不得重复启动完整前台轮询窗口。到期进入现有维护待办；只有待办落盘或下次核对确已安排才能显示相应提示。长期等待不等于真实失败，也不承诺无限自动轮询。
- 具体落点：原ID明确的任务走 `listRecovering → claimRecovering → resume` 及原ID查询/保存分支，不转 `queued/retrying`，不增加attempt或清空provider_task_id。`resume`仍校验原accepted/response-received证据；未知ID不强行resume。统一 `claimRecovering`、启动decision、恢复扫描及维护worker使用 `originalRecoveryWindow` 的匹配Provider attempt时间，替代当前以task.created_at另算窗口的分支。时间/冻结合同缺失不赠送新窗口，保留待处理。checkpoint计数及退避按原task/attempt关联，保留state+updated_at事务抢占。
- 整个自动安全窗口耗尽：本次合格的活动工作流task保留recovering及待处理原因，持久到期标记使普通扫描不再查询；维护待办登记失败也保留到期事实供补登记。修正当前 `claimRecovering` 在此处写failed/OPERATOR_INCIDENT的分支，不能让“维护升级”自动终止仍未知的工作流。已存在历史OPERATOR_INCIDENT不迁移。用户可按现有停止流程退出；关联工作流锁/未决请求保护不因到期被私自释放。恢复已停止时UI显示待处理而非持续生成；无可靠新证据不得自动重开窗口。
- 接管前检查现有runtime及保存租约，过期本身不证明旧写入停止。恢复worker不得在仍活跃的前台请求旁再启动提交或并行保存。扫描公平轮转、不长期占住工作线程；取消/全局暂停/停服排空在等待、查询、保存及投影边界均生效。
- 等待不会持有SQLite事务或平台配置锁；仅保留该原工作流需要的图锁/容量事实，不把未决保护解除冒充资源优化。加测同账号另一不重叠工作流仍可在既有容量限制内正常执行，恢复排队不能吞占全局执行线程。到期任务有可见停止入口；停止不等于平台已取消或未扣费。
- 活动run中，对应node保持 admitted，未准入依赖保持 pending；原task真正success后沿既有完整绑定核验、node成功与投影流程推进。不能把所有 `failed + RESULT_DELAYED` 历史记录当作待恢复活动节点。真正failed/cancelled仍按原规则阻断依赖。
- 已成功node但投影failed只重试同一投影；不能为等待画布显示重复准入下游。业务完成与画布同步分开表示，前端由服务端真实状态清除旧错误。永久输入冲突保留原结果，不无限重投影覆盖用户修改。

实现必须同时核对 task-store、启动扫描、自动恢复扫描、维护worker、workflow调度及客户端等待器对 recovering 的行为。只改 `isTransientRelayPollError` 不满足施工范围。

## 4. 本次历史事故：只同步已成功原结果

### 4.1 新窄命令及schema44持久证明

新增内部 dry-run/apply 命令，限定本次明确授权的 owner/canvas/run/node/task/attempt/Provider及结果身份。没有面向浏览器的任意“修成功”接口；不由客户端提供成功、退款或付费证明。实际处理前重新生成当前数据预检清单，授权范围不能沿用上个事故。

同事务核验：原task success、完整现代workflow绑定；run/node历史failed但未stop/cancel；目标未被新任务替换、无冲突活动run；原图语义/输入/模型版本仍匹配；原结果所有合法slot齐全，publication published与asset ready、owner/kind/Provider attempt/远端ID/存储身份/字节/哈希一致且无删除或隔离。首轮只允许本次单输出视频，不扩大到未知旧slot或多输出事故。对象存在与可读取另在获授权生产操作前核实，网络不放在SQLite事务内，事务内复核清单未变化。

不写 `generation_result_adoptions`，不把 task 改failed后重走旧采用，不改媒体、Provider费用/usage、原run/node历史及前9个结果。通过现有 `buildCanvasProjectionIdentity` 和 `server.projection` gateway 写Canvas，使用已有 `canvas_operation_receipts` 持久证明。只在此命令的完整预检通过后允许该历史绑定投影。

幂等身份使用原投影构建器的 operationId/payload digest；重复执行先重建并核对 owner/canvas/type=`server.projection`/actor=`server`/成功outcome/payload。不能只看“有收据”。正常投影与本窄命令对同结果共享幂等身份，不制造第二份应用。事务失败不得留下“已经同步”的假收据；如果gateway返回failed或conflict，操作明确报告未同步，不启动后继。重复调用还要核对当前节点实际仍对应原结果；用户后来改过或删过节点时，成功旧收据不能授权覆盖新内容。

输出仅为：`已同步`、`已同步且本次无写入`、`结果保留但当前节点已变化`、`证据不足/同步失败`。前两项必须实际读回Canvas确认；后两项保留原任务结果供查看。该命令不具备Provider提交能力。

### 4.2 未执行下游的后继

延用生成合同2.4的显式“继续未完成节点”。对本事故，先成功同步，再单独生成预览；不把同步操作附带变成新的付费生成。

`frozenTaskSource` 增加受保护分支：原task success + ready完整结果 + 精确成功server projection收据，且未被替换、取消或改输入，才允许把历史failed节点的原结果作为冻结外部输入。原A/B/C adopted分支及普通成功node分支保持。`canonical_adoption_receipt_id` 对此分支为NULL；在现有 `frozen_external_inputs_json` 的 `successful-task` 来源中增补 `serverProjectionOperationId` 及需核对的投影payload身份，不能伪称 adopted-result。

预览、创建后继和每个下游准入都复核该来源及冻结媒体/文字身份，不把变化后的素材重新冻结为原输入。类型、JSON解析器及预览摘要同时更新；父run仅一个后继、节点幂等键不因重复点击/重启变化。只选尚未准入且上游已满足的节点，前9个成功节点和原视频不重跑。用户取消、旧run.stop_requested、输入变化或另有未决请求时不得自动继续。

普通新活动run的临时恢复后续推进沿原整组执行授权自动完成，不新增必点按钮。历史事故下游需要新生成时，操作前说明数量及可能费用，由本次授权单列；本轮方案授权不包含执行。

## 5. UI、正常功能和数据保护

直接使用UI合同5.9现有组件和服务端状态映射：短暂恢复中性显示，不连续全局弹错；已保存待同步不能显示生成失败；恢复结束移除旧提示；维护入队失败不能说已安排；取消不能显示将自动继续。历史原run保持失败历史，当前节点可以显示已找回结果，不能把历史run展示成新成功run。

必须保留：正常四类节点、单节点补跑、原退款一次补偿、未知付费保护、单/多输出发布、原结果保存所有权、停止/取消、DATA-005保存规则、跨标签同步、选中白框、菜单层级、节点/组位置连线及用户尺寸。仅本链路所必需的共享入口改动；不扩大到其他模型协议重构或暂停功能。

schema决策：使用现有schema44 task states、任务事件/现有维护记录、Canvas投影收据与后继JSON；不新增表列/CHECK枚举，不迁移现有生产记录或批量改历史。JSON来源扩展仍须验证新旧数据读取，不能因SQL未迁移就宣称旧应用兼容。若实施证明此选择无法持久表达必要事实，先修订方案复审，不临时绕过schema校验。

## 6. 验证与验收

实现后用项目safe runner、临时数据库/模拟Provider及OSS、动态loopback。先真实复现旧代码故障，再用同一用例验证新实现；不在生产注入故障，不以人工预先写success掩盖生命周期缺口。

| 必测场景 | 断言 |
| --- | --- |
| 真实视频状态查询获取锁失败，随后解除 | 原代码呈现task成功/run失败/Canvas空的故障；候选沿真实worker最终自动显示并推进 |
| 锁忙跨越前台轮询窗口；配置权限错误 | 前者持久恢复，后者保留准确原因与提交后保护；均不伪造平台失败 |
| 崩溃在交接提交前/后、查询后/保存前、保存后/投影前 | 重启沿同task/attempt恢复，原deadline不重置，旧活跃runtime不被并行接管 |
| 轮询总预算耗尽、维护登记失败、全局暂停 | 不无限请求、不谎报处理、不新提交；按真实持久状态展示；暂停不新增付费动作 |
| 取消在等待/查询/保存/投影前，与结果并发 | 取消胜出的边界无迟到覆盖/下游准入；已完成的原子提交不被伪装撤销 |
| 重复扫描、跨标签及并发worker | 同视频Provider提交严格1次，同slot保存/结算及下游准入不重复 |
| 已保存但Canvas事务失败/重试、结果后的刷新 | 不降级task、不生成第二份视频；最终原节点结果可播放且刷新仍在 |
| 用户改输入、替换任务、删节点、改连线/模型 | 旧结果保留可查，不覆盖新输入、不偷偷续跑 |
| 本次结构的历史success task/failed node，无旧adoption | 新命令dry-run零写，apply实际投影，重复零增量；旧A/B/C入口仍拒绝不适用数据 |
| 历史后继预览/创建/重启及素材变化 | 只有授权的新下游被执行一次；前9节点和视频账本、位置、连线不变；变化来源拒绝 |
| 真实失败、取消、未知ID/计费及已有退款补偿 | 原终态和一次补偿预算不放宽；不为修UI打开新提交 |
| 无故障四类节点/组、正常单节点补跑、1/2/4合法输出 | 保留既有成功路径，按共享改动影响选择现有回归，失败先定向查证 |
| 窄节点/缩放/长错误/菜单/选中白框 | 同一主要提示，不遮挡、不改持久尺寸；恢复状态与服务端一致 |

计数证据必须分别记录“视频提交1次（已提交后恢复新增0次）”和“合法下游各首次提交1次”，不能把正常下游收费误报为重复收费。首行必须从真实查询异常进入，不能只调用保存helper模拟锁忙。到期场景应明确可见待处理，不要求不可能的最终成功。新旧功能回归、独立代码复审和本地撤销演练均通过后才提供用户验收。

给用户的本地验收采用同页操作并定位目标节点，明确三项：①开始临时中断演示，不点重试，视频自动出现且尾文字完成；②恢复中刷新，结果最终仍在同处；③查看历史事故演示，只补原视频，再明确选择继续未完成节点，其他节点不变。计费次数、内部账本、并发与回退由工程证据负责，不要求用户查日志。真实用户输入或取消的保护另外演示，不把所有用户验收堆成不明白的按钮。

## 7. 撤销与以后发布的门

本轮只写方案文档。实施获授权后先在隔离数据中做候选启动→排空停止→schema44只读维护桥→候选重启的演练；恢复中的原请求身份、资产、Canvas及新增投影/后继JSON必须保留。桥不运行worker，HTTP写入返回维护状态，不访问Provider/OSS；正常新请求也不可用。这是保数据的停机回退，不承诺切桥后仍可生成。

代码撤销保留当前schema44数据，禁止恢复旧备份覆盖新结果、删除账本或启动不兼容旧schema应用。重新启用候选前验证来源、数据完整性和待恢复任务；重启只能查询/保存原请求，后继未获准执行不能借重启提交。

将来发布必须另核对当前线上版本、数据、活跃请求、精确备份/fresh restore、Linux演练及回退桥绑定。发现重复Provider提交、取消后写回、绑定错位、数据校验失败即停止推进，保留证据进入维护；不可靠反复发布试错。本地证明不能替代真实线上对象/画布核验；本轮不做生产备份、对象访问、数据库写入或付费验证。

## 8. 复审记录

历史方案审查快照：第1～8节保留当时状态，不随实施改写；当前实施结果以第9节和TASKS为准。

第1版只读审计：未通过，原因与修正见第2节。

第2版：`DOCUMENT_GO`，2026-09-13独立审查代理 `/root/recovery_plan_audit` 完成只读复审，结论为前审阻断已补齐，未发现方案与既有schema44/保护规则的直接冲突。审核正文为本文件第1～7节（含第8节标题之前的全部UTF-8内容），SHA256 `32909393d3c0a924a22211df7da01e4153ad82703a2e332927cb7efd2c930a7b`；代码基线见第1节。审查同时覆盖TASKS、当前状态新增事故说明及生成合同拟议2.5/3.2。

复审确认：锁异常分类及请求阶段分离；原attempt统一截止；取消/并发所有权保护；历史task已成功时的新窄投影及后继来源证明。非锁本地错误必须单独诊断，但已提交时仍按3.1保留原请求保护，不能把“非锁错误”一律解释为平台终态。

实施硬门仍未验证：

1. 启动扫描、30秒恢复扫描和维护worker一致识别到期标记，普通自动恢复到期后新增Provider GET为0，重复扫描到期登记只一次；后续有可靠新证据的受保护操作另算。
2. `claimRecovering` 不再把本候选合格活动task到期写failed；原attempt时钟、checkpoint、取消及并发CAS按第3节核验。
3. 配置锁原始错误分类、轮询捕获及外层错误处理同步完成，不误恢复非锁故障、不重发原付费请求。
4. 取消竞争、进程崩溃接管、历史同步收据与Canvas读回、后继来源证明、新旧功能回归、本地撤销演练全部完成后再进行独立代码复审。

本轮仅方案与文档：定向文档链接、入口长度及 `git diff --check` 通过；未运行产品测试、未执行撤销演练、未处理生产数据、未做Provider/OSS调用、未实施/部署。`DOCUMENT_GO`不等于`AUTO_PASS`、`USER_PASS`或上线许可，实施授权见TASKS。

## 9. 本地实施记录

当前结论：工程验证为`LOCAL_AUTO_PASS`；最新用户验收状态由TASKS拥有。已完成用户授权的本地修复、新旧功能回归、schema44本地撤销演练、独立代码复审及完整真实浏览器链路；没有生产读取/写入、真实Provider/OSS或付费调用，没有提交、推送或部署。方案第1～8节及开头“未实施”是审核时冻结快照，正文哈希保持第8节记录值；不能把它作为现在进度。当前授权与验收由TASKS拥有。

代码基线仍为HEAD `300e3e891d87f3d294a4be24b780a07b315bee2a`，起点4个方案文档改动已保留。运行时按完整现代工作流身份保留原video task/attempt/Provider；前台退出交接持久恢复、原始attempt统一截止、启动/扫描/维护共用到期标记；到期不重置预算、不重发生成、不伪称已有人处理。历史已成功原视频通过内部窄投影和真实server.projection收据回填，父run/node保持failed；受保护后继只准入未开始节点，重复操作复用同一关联。没有新增跨域SQL豁免或数据库迁移。

网页复验额外定位并修复刷新丢文字：`/tmp/unboundry-video-query-product-observe-20260914.log`记录重放commit-user-layout后误发delete content/contentHtml。`hydrateCanvasPersistence`原先把旧pendingSnapshot当成重放后的整图，忽略现代响应中包含新结果的authoritativeDocument。现校验权威文档及版本一致性后使用其nodes/edges/viewport；旧响应无该字段时保留原回退。未修改DOM编辑规则或扩大服务端写权限。

独立复审：`/root/video_query_code_review`关闭产品阻断（安全原始错误码白名单、历史Provider-boundary来源及同task锁忙证据）；`/root/text_projection_diagnosis`根据实际现代命令请求复审刷新修复、新m86回归、真实临时会话、Playwright无侵入观察及隔离重置，无剩余阻断。方案审查、代码复审、自动验证、用户验收分别记账。

相关回归共351项有效通过，均经 `node scripts/run-safe-tests.mjs`，Node22.23.1/npm10.9.8、临时数据和动态loopback：

- 旧生成正常路径219项：`/tmp/unboundry-video-query-normal-regression-20260914.log`，退出0；覆盖m26、m40幂等/调度/worker、m41重试UI、m44原子性、m103工作流、m107采用、m108容量、m88发布、m98UI。source SHA256 `efb1e38032754f6aa84f7ad7cba2d8e911a01074ccc77fe89c89dd70463cd043`。
- m109后继10项+m114 UI2项：`/tmp/unboundry-history-recheck-1789314577795.log`中对应12项有效；当批m110/m113夹具失败不计通过。纠正后`/tmp/unboundry-history-rollback-recheck-1789314681617.log` m110 3项+m113当时7项10/10、退出0。
- 最终m112 5项+m113 8项：`/tmp/unboundry-video-query-audit-fix-20260914.log`13/13、退出0，source `3df64bcfaee0db025b3aed03998e46e8db21bb8be3f18862e986feb412710f24`；包含原attempt截止/取消/持久标记、安全日志、窄同步/防伪/读回回滚/后继来源、真实CLI dry-run/apply/错误proof/幂等。
- 刷新修复后m3保存14项：`/tmp/unboundry-video-query-replay-regression-pass-20260914.log`中14/14。m86新增例当批第二次刷新因模拟高水位ID不符合UUID契约而失败；纠正测试数据后只重跑m86：`/tmp/unboundry-video-query-replay-recheck-20260914.log`90/90、退出0，source `845c04b3b4110c1f2ef483b727a68b744a6f3e8170fa8cb3fba3b5f3198aa494`。覆盖旧响应回退、跨标签/迟到请求、DOM新输入、格式、刷新重放和新生成结果保留。最终有效报告均无失败、跳过、重试、外部阻断或报告错误。

撤销实跑：m110候选→schema44只读维护桥→候选，保留原请求账本、素材、Canvas、新投影收据及successful-task后继JSON；桥不访问Provider、不写数据。存储保全不代替历史语义正确性，后者由m113及完整链路证明。最后刷新补丁仅改变客户端重放后的组装，不改变数据库或桥兼容范围。

完整同页浏览器与旧新对照：`/tmp/unboundry-video-query-product-replay-fixed-20260914.log`退出0、blocked0、原工作树与4173未变；source SHA256 `25bfc42daebbd56214210963eac7d104e5517bfc85ac0b25484912553553f8bc`。冻结旧HEAD/tree的211份server/types，在真实假Provider查询及真实SQLite配置锁竞争下复现旧RESULT_DELAYED：原task最后success，run/node仍failed、Canvas空白、尾文字0提交；此旧对照不是整套旧生产客户端包。

候选同task实际ProviderProfileLockBusyError/PROVIDER_LOCK_BUSY/SQLITE_LOCK_CONTENTION后，原视频沿attempt1自动恢复、可播放、原活动workflow和尾文字自动完成；视频提交1次、合法尾文字首次提交1次。历史原视频同步成功，父run/node仍failed，仅新尾节点执行一次，无伪adoption、无第二次视频提交，九个成功节点及连线位置未变。恢复中刷新及历史后继刷新后的实际DOM检查通过。到期场景只向截止命令注入测试时钟，原attempt账本不改；等待实际worker35秒后新增GET0，视频POST仍1，spinner停止、等待提示可见、锁保持。pageErrors/外部访问均0。最后隔离数据重置和读回核对通过。

最终结构化报告与已目视核对截图保存在 `/tmp/unboundry-video-query-final-evidence-20260914/`：`product-smoke.json`、`video-query-workflow-product-smoke.png`、`video-query-workflow-expiry-smoke.png`。生产事故的底层锁持有者仍未知；本地复现同类竞争不等于证明了当时锁持有者。真实事故回填与未来发布均需另行核对现状及对应授权。本轮用户验收结果及会话收尾证据见TASKS，不在此重复维护。
