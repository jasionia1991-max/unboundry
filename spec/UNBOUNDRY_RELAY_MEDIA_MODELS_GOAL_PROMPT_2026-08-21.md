# 新 Session 一次性 Goal 提示词

状态：`LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`（2026-08-21）。本提示词已执行完成，仅保留为历史施工合同；不得据此自动复用Goal或发布授权。结果提交边界commit为`3144d7a`，三模型合同commit为包含本回执的`feat(generation): add relay media model contracts`。真实Provider smoke为`PAUSED`，版本、GitHub、发布和生产均未进入。

将下面全文复制到新的 Codex Session：

```text
/goal

请创建一个新的 Goal，一次性连续完成 Unboundry 的：

“同一中转站三媒体模型接入与异步结果边界治理”。

目标模型：

1. 图片：Nano Banana Pro，Provider模型ID `gemini-3-pro-image-preview`；
2. 视频：Kling V3 Omni参考生，Provider模型ID `kling-v3-omni-cankao`；
3. 音频：Suno V4.5，Provider模型ID `suno-v4.5`。

三者属于同一个中转站，API base URL为 `https://api.lk888.ai`，统一使用现有 `multi-protocol-relay + media-generate`。不要新增ProviderDriver，不要新建平行Media Provider registry，不要接Google原生generateContent双轨，不要启动Storage backend第三批。

这是一个新的、一次性连续施工Goal。允许你在本Goal内完成必要的只读分析、代码、测试、文档同步和两个独立本地commit；普通实现难题或定向测试失败不需要停下来询问，应该自行诊断并继续。允许使用subagent并行做只读审查，但必须避免重复测试，所有subagent固定使用gpt-5.6-luna/max。

本Goal不授权版本升级、push、PR、merge、tag、发布、SSH或生产。自动测试禁止真实Provider、真实OSS和真实密钥。若环境已经显式提供专用测试凭据和独立真实smoke开关，可在所有fake门通过后最多执行3次创建POST：Nano 1K文字图1次、Kling 5秒std文字视频1次、Suno纯音乐1次；任何未知响应/失败/超时均禁止自动重试。没有专用凭据时标记REAL_PROVIDER_SMOKE_PAUSED，不阻断本地工程完成。绝不读取app/data、/var/lib/unboundry或生产数据来获取凭据。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、项目身份
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

真实仓库：

/Users/mymy/Documents/unboundry/app

预期分支：

codex/unboundry-offline-remediation-2026-08-09

方案冻结基线：

- HEAD `e7016eb26ad3a7ae9829067a057b1206d3c2b3c4`，或只比它多一个本方案文档commit；
- package `0.6.27`；
- 正式施工Node `22.23.1` / npm `10.9.8`；
- 同步文字Provider port第一批已经本地完成，未发布；
- 线上仍为v0.6.27/schema39 USER PASS，但任何旧发布/生产授权都已消费，禁止复用；
- 唯一允许的未跟踪文件是 `spec/public-templates-director-split-revision.json`。

受保护JSON禁止读取、修改、格式化、移动、删除、暂存、提交，也不得进入测试fixture、snapshot、build或artifact。

第一动作执行：

pwd
git status --porcelain=v1 -b
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -5 --oneline --decorate
node --version
npm --version
node -p "require('./package.json').version"
git diff --quiet HEAD origin/main --

身份、工作树或受保护边界冲突时才停止。禁止reset、clean、stash、强制checkout或覆盖用户改动。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、必读顺序
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

完整遵守仓库AGENTS.md，并按其要求读取当前权威文件。随后完整阅读：

1. spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md
2. spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md
3. spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md
4. spec/UNBOUNDRY_RELAY_MEDIA_MODELS_INTEGRATION_PLAN_2026-08-21.md
5. spec/UNBOUNDRY_RELAY_MEDIA_MODELS_ACCEPTANCE_MATRIX_2026-08-21.md
6. spec/UNBOUNDRY_RELAY_MEDIA_MODELS_CHECKPOINT.md

方案和矩阵是本Goal冻结合同。不要重新做全仓模块审计，不要扩张到Canvas、Workflow、Templates、Auth、Storage backend或Release。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、连续施工阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stage 0：只读冻结当前真实调用链和所有权。

Stage 1：落实路线图第二批。

- 建立Generation拥有的GenerationResultCommit；
- Media publication返回transaction-scoped token/evidence；MediaLifecycle/MediaRegistry的reserve、finalize、fail、recovery、delete都不再查询或更新generation task/attempt；
- GenerationResultCommit是唯一事务编排者，publication、provider attempt、task success和event仍使用同一BEGIN IMMEDIATE/同一DB session；Media port不得另开嵌套事务；
- 生成媒体保存函数返回assetId + publication token；
- 解除generationTaskStore与generationSafety运行时循环；
- 不削弱attempt、idempotency、providerTaskId、credential lease、retry/reconcile和owner/model归属。

Stage 2：建立小型声明式relayMediaModelContracts。

- 它只表达现有media-generate下的模型级参数、输入和轮询差异；
- 不建立新的Provider registry；
- 未登记模型继续走现有generic relay路径；
- 禁止在executeImageTask/executeVideoTask/executeAudioTask新增品牌分支。
- 修复server/multiProtocolRelay.ts对`gemini-3-pro-image-preview`的能力发现：该精确ID必须在Gemini文本规则前判定为image，并由m55固定。

精确映射：

Nano：aspectRatio原样；quality 1k/2k/4k → imageSize 1K/2K/4K；0-14图片引用 → images；outputCount固定1。

Kling：aspectRatio → aspect_ratio；duration严格发字符串5/10/15；新增videoMode并映射standard/quality → std/pro；0-7图片引用 → images；禁止视频/音频参考；outputCount固定1。

Suno：固定mv=chirp-v4-5；musicGenerationMode映射到make_instrumental；vocalGender映射auto/m/f；新增sampleRate 44100/48000；新增bitrate 128000/192000/256000；不接受媒体参考；outputCount固定1。

Stage 3：持久长任务恢复。

- 截止时间从真实paid attempt created_at计算；
- Nano 10分钟、Suno 15分钟；Kling必须完整覆盖文档约70分钟并加有限grace，建议总窗口75分钟；
- 5秒轮询起步，有界到10秒；
- 服务重启后有providerTaskId只能查询原任务，POST必须为0；
- 提交响应丢失时不得二次POST；尤其Suno若不能通过唯一usage记录安全匹配，只能保持outcome_unknown等待人工核对；
- /v1/skills/task-status仅在404/405回退/v1/media/status；401/403/429/5xx/网络错误不得回退；
- 没有refunded:true不得自动付费重试；
- 文档没有cancel接口，不得声称远端取消或退款；
- Provider cost单位未核实时不得编造或覆盖可信本地成本。

Stage 4：结果提交、错误与清理。

- result_type必须匹配目标kind；
- Nano当前只接受并验证PNG；
- Kling走MP4；Suno走现有支持的音频类型，首选MP3；
- 下载/保存失败可安全重试，但不得重新创建Provider任务；
- 清理失败不得把成功推理改成失败；
- 迟到结果必须匹配task/owner/model/executionAttempt/providerTaskId。

Stage 5：风险驱动验证、文档与本地commit。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、允许修改范围
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

默认允许：

- server/generationResultCommit.ts（新增）
- server/generationAttemptQueries.ts或等价文件（新增）
- server/relayMediaModelContracts.ts（新增）
- server/generationTaskStore.ts
- server/generationSafety.ts
- server/generationTasks.ts
- server/relayProviderAdapters.ts
- server/multiProtocolRelay.ts
- server/mediaLifecycle.ts
- server/mediaRegistry.ts
- server/assetStorage.ts
- server/videoStorage.ts
- server/audioStorage.ts
- types/modelParameters.ts
- m5/m14/m38/m40/m44/m53/m54/m55/m57/m88及必要的新合同测试
- 必要时最小同步safe runner清单/source coverage manifest
- 本Goal四份文档、TASKS.md和CURRENT_STATE当前区块

范围外文件只有直接编译或冻结测试证据确实要求时才允许最小修改，并在最终报告说明。

明确不修改：Canvas、Workflow、React节点、Templates、Auth、Model Catalog业务语义、Storage backend、OSS结构、数据库schema、版本、release和生产配置。若现有字段经证明无法承载持久截止，先记录BLOCKED证据；不得静默新增migration。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、测试预算
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 使用Node22.23.1/npm10.9.8；
- 自动测试只用新临时目录、动态loopback和fake fetch；
- 禁止4173、app/data、/var/lib/unboundry、真实媒体、真实密钥、OSS和生产；
- 不按Stage重复启动runner；全部相关代码完成后只用一次safe runner统一执行preflight、TypeScript、构建和定向spec；
- 统一集合：m5/m14/m38/m40/m44/m53/m54/m55/m57/m88；模型合同优先补入这些直接spec，确有职责隔离才新增一个合同spec并加入同一命令；
- storage签名真实影响既有合同才追加m37/m80/m87/m90；
- Canvas/Workflow未改不跑m22/m41/m68；
- 测试失败只重跑失败spec或最小子集；成功后没有新相关代码变化不得重复；
- 默认不运行full。只有公共安全入口/schema/跨域合同的风险传播证据明确要求时，最终最多运行一次full；否则在报告中诚实说明未跑full和定向覆盖。

最终统一命令：

node scripts/run-safe-tests.mjs run \
  --spec tests/m5-generation-task-store.spec.ts \
  --spec tests/m14-generation-safety.spec.ts \
  --spec tests/m38-generation-runtime-incidents.spec.ts \
  --spec tests/m40-generation-idempotency-recovery.spec.ts \
  --spec tests/m44-provider-profile-atomicity.spec.ts \
  --spec tests/m53-relay-provider-adapters.spec.ts \
  --spec tests/m54-provider-result-media.spec.ts \
  --spec tests/m55-relay-model-protocol.spec.ts \
  --spec tests/m57-relay-generation-runtime.spec.ts \
  --spec tests/m88-media-publication.spec.ts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
六、完成与提交
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

必须逐项完成验收矩阵P0，更新矩阵为AUTO_PASS并记录命令、环境、退出码和零越界证据。

创建两个独立本地commit：

1. refactor(generation): own media result commits
2. feat(generation): add relay media model contracts

只提交本Goal文件。受保护JSON不得进入index。不要push、PR、tag或发布。

最终状态只能是：

LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW

真实Provider smoke若无专用凭据标PAUSED，不阻断本地工程；自动测试、真实Provider smoke、生产发布和USER PASS必须严格区分。

最终向我报告：

- 实际完成结果；
- 两个commit SHA；
- 真实调用链和所有权变化；
- 三模型参数/输入/轮询最终合同；
- 每条测试命令、环境、退出码和通过数量；
- 为什么没有过度/重复测试；
- full是否执行及原因；
- 真实Provider、OSS、4173、真实数据、受保护JSON和生产是否触碰；
- 剩余风险及需要我手动确认的页面项。

完成第一至第五阶段后停止，不自动进入版本、GitHub、发布或生产。
```
