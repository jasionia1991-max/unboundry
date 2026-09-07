# Unboundry 当前生成与画布结构

更新日期：2026-09-07。本文维护本项目的结构、职责和行为边界；产品版本、部署、性能结论及未决事项只由 [CURRENT_STATE](UNBOUNDRY_CURRENT_STATE.md) 维护，授权见 [当前任务](../TASKS.md)，逐项验收见 [总矩阵](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。上游观察另见 `UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`，不能据此前端材料推断上游内部架构。

2026-09-07按当前代码与发布验收证据纠正旧状态描述，核对范围见当前任务；没有因此重跑全部功能或真实生成。2026-09-06的逐文件查阅深度保留在 [历史源码清单](PROJECT_SOURCE_REVIEW_COVERAGE_2026-09-06.tsv)，代码存在不等于所有Provider/模型都已真实验收。

## 1. 结构和职责

系统是React/Vite前端、Node服务端、SQLite持久化及媒体存储组成的单体应用，已形成模块端口与组合根，并非只有前端工作流，也没有因模块化而拆成微服务。

| 范围 | 当前入口与职责 |
| --- | --- |
| 页面、工作空间 | `client/src/App.tsx`；账号/项目/画布与版本更新提示 |
| 画布交互 | `client/src/canvas/CanvasSurface.tsx`及节点组件；本地交互、命令提交、服务端结果应用 |
| 输入语义 | `types/nodeInputs.ts`、`types/modelInputSemanticCompiler.ts`、`types/workflowSemanticPlan.ts`；解析入边、角色、顺序、提示词和模型输入合同 |
| 组合根 | `server/applicationComposition.ts`；组合auth、canvas、generation、imageTools、library、media、provider及Seedance专属接口 |
| 请求准入 | `server/generationTasksApi.ts`、`server/generationAdmissionApplication.ts`、`server/generationTaskStore.ts`；身份、模型合同、幂等及持久任务绑定 |
| 服务端工作流 | `server/workflowRunsApi.ts`、`server/workflowRunService.ts`、`server/workflowRunLocks.ts`；持久run/node、依赖推进、公平调度、停止和结果结算 |
| 生成与Provider | `server/generationTasks.ts`、`server/mediaGenerationProvider.ts`、`server/providerRuntimeApi.ts`及各Provider runtime；提交边界、任务查询/恢复与结果归一化 |
| 素材发布 | `server/mediaPublicationService.ts`、`server/mediaBlobStore.ts`、`server/generationResultCommit.ts`；媒体对象、staging、publication和任务结果登记 |
| 画布投影 | `server/generationCanvasProjectionService.ts`、`server/canvasWorkflowProjection.ts`、`server/canvasMutationGateway.ts`；按精确绑定把结果写入Canvas，独立记录同步失败 |

2026-09-06历史架构扫描：298个应用TS/TSX文件，1039条runtime边、274条type边；88条登记例外（73跨域SQL、12跨域internal、3Provider/Storage），新增、失效和无效项均0，runtime SCC为0。本次没有重跑该扫描；这些计数只证明当时的静态合同检查通过，不证明零耦合或当前全部函数无缺陷。

## 2. 当前生成链路

```text
单节点输入 / 模板组输入
  → 输入解析与零费用preflight
  → HTTP单节点准入 / 服务端持久workflow准入
  → authoritative模型配置、owner/canvas/node/revision/幂等检查
  → 事务保存任务及绑定，再启动同一个任务
  → Provider attempt边界 → 提交或核对原任务
  → 文字结果 / 媒体字节与publication保存
  → task结果结算 → workflow节点结算（若属于workflow）
  → 精确Canvas投影 → 客户端逐节点应用并显示
```

统一输入与服务端workflow都已经实现，不能继续标记“计划中”。具体可提交能力由当前已发布模型合同、Provider连接/驱动、输入及安全门共同决定，范围包含text/image/video/audio；不能概括为“仅图片和视频可提交”，也不能据此宣布Mureka等真实生成已经验收。

工作流准入还受`server/modelExecutionRegistry.ts`的恢复等级限制：ark-text、ark-video、mureka-audio、relay-media标为eligible；同步openrouter-image、relay-gpt-image不具备同等级结果找回证据，强工作流准入为false。单节点可用不等于可放入工作流；eligible也不是生产验收结论。

浏览器不持有Provider密钥，不直接把任意外部URL或本机路径当作可信素材。服务端复核owner、asset、类型、ready、模型输入合同与绑定；不可变输入/模型身份用于后续核对。短时签名地址属于Provider传输材料，不应成为画布持久事实。

`admitPreparedGenerationTask`由HTTP和持久workflow共用；先提交任务再启动。现代单节点在同事务绑定Canvas；workflow有自己的run/node绑定。响应传输失败不代表准入未成功，不能靠重复POST判定或“修复”。

## 3. 保存成功与画布显示的边界

媒体对象写入和数据库事务不是一个跨系统原子事务。staging/publication保存中间证据，持久恢复链负责后续发布，不能把原流程简写成“先直接落媒体目录，再一次性全部成功”。

`commitGenerationMediaResult`校验task/owner/kind/attempt和Provider attempt身份，在事务中完成媒体发布登记、任务成功、attempt完成及事件，并调用单节点Canvas投影。**Canvas投影使用savepoint和独立状态**；可隔离的投影失败保留已保存结果，再尝试同一结果的同步，不重新发起Provider生成。事务本身或savepoint恢复失败仍会抛错，不承诺所有故障都能自动恢复。

workflow节点结果也分别记录业务state与projection_state；`retryFailedWorkflowProjections`只处理已成功但投影失败的节点。task成功、workflow节点成功、Canvas投影完成和用户看到内容是不同证据，不能互相替代。

结果与Canvas owner/node/task及输入指纹必须精确对应。旧客户端缓存只能帮助恢复交互，不能覆盖服务端任务结果或为未知计费结果重新生成。`accepted/response-received/outcome-unknown`、有无远端任务ID以及publication证据决定核对路径；具体Provider的恢复能力不可类推。

## 4. 当前显示和尺寸合同

新图片/视频auto节点在可信素材接管或结果投影时按素材比例适配。旧节点没有尺寸模式时保留旧大小；manual节点保留用户尺寸，主动适配通过正式命令并可撤销。加载、播放、metadata、刷新不应触发布局写入。视频节点内部约束播放器可用高度并使用contain，避免竖屏下半截被裁切。

模板节点位置不自动重排，竖屏高度增加后的重叠由用户整理；选中模板整体使用临时层级置前，不重写持久zIndex。该优先性由selected触发；仅新插入模板、设置primaryId不等于选中或自动置前。完整规则见 [UI合同](UNBOUNDRY_UI_DESIGN_SYSTEM.md)，已验收范围按总矩阵对应条目查证。

前端会按节点消费服务端结果；这说明代码不要求等待整组结束后才显示，不承诺零延迟。历史缩略图和首次画布的性能状态见 [当前状态的未决事项](UNBOUNDRY_CURRENT_STATE.md#未决事项)，测量方法与适用范围见 [性能证据7.2](REMAINING_BUG_UI_REPAIR_PLAN_2026-09-07.md#72-性能结论与范围)。本地目标通过不能推导为正式站性能基准或竞品对标通过。

Canvas写入口受命令/写者清单约束，DATA-005仍是跨标签最后保存者胜并同步、同标签拒绝迟到旧请求，不得误写成跨标签全局CAS。

## 5. 运维与验收边界

线上HTTPS、systemd和服务端workflow已有实现；实际版本、schema及运行入口以CURRENT_STATE链接的发布回执为准。手动加密备份、恢复演练、云端核验和每日自动备份是不同验收项，其现状由CURRENT_STATE维护；不能用一次手动备份通过代替自动作业验收。

CI配置见 [.github/workflows/quality-gates.yml](../.github/workflows/quality-gates.yml)，包含类型、架构、生产build、high阈值依赖审计、安全预检、隔离HTTP/fake Provider工作流与文档检查及源码覆盖。配置了检查不等于某次运行通过；实际run与范围由相应任务和发布回执记录，不扩大为所有测试套件、真实Provider或灾备通过。

维护后更新通知、依赖修补、性能和暂停项的现状统一见CURRENT_STATE；本文不保留另一份会落后的待办列表。具体操作看 [发布Runbook](../RELEASE_RUNBOOK.md) 与 [备份运维](../ops/production/README.md)。专项加固方案只有被当前任务明确选中才约束该项工作，尚未实施的方案不能写成现有行为；本文不构成运行旧脚本、发布或付费生成授权。
