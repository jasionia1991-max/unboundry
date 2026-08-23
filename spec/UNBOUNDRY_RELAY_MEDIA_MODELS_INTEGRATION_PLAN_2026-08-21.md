# Unboundry 同一中转站三媒体模型接入施工方案

更新日期：2026-08-21

状态：`PRODUCTION_PUBLISHED / SUPERSEDED_BY_V0_6_29_30_REAL_EVIDENCE / CURRENT_V0_6_33_USER_PASS`
施工目标：在现有 `multi-protocol-relay + media-generate` 通道中接入：

- 图片：`gemini-3-pro-image-preview`（Nano Banana Pro）；
- 视频：`kling-v3-omni-cankao`（Kling V3 Omni 参考生）；
- 音频：`suno-v4.5`（Suno V4.5）。

当前收口：本方案的本地工程随后随 v0.6.28 发布；v0.6.29 在独立云腾 Provider 下完成三次有界真实创建，v0.6.30 在零新增 POST 前提下修复 Nano JPEG 和 Suno 多音频结果并完成生产、用户验收。当前状态以 `spec/UNBOUNDRY_CURRENT_STATE.md` 为准，本方案不再是待施工入口。

关联文件：

- `spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`；
- `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_ACCEPTANCE_MATRIX_2026-08-21.md`；
- `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_CHECKPOINT.md`；
- `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_GOAL_PROMPT_2026-08-21.md`。

## 1. 一句话裁决

这不是新增三个 Provider driver，而是在同一个中转站、同一个异步媒体协议下新增三个模型合同。继续使用 `ProviderDriver = multi-protocol-relay` 和 `ProviderProtocol = media-generate`，不新增 Storage backend，不新增 Canvas 节点，不另造平行 Provider 抽象。

真正的前置瓶颈是：现有 Media publication 会直接完成 Generation Task，且 Kling 文档允许任务处理约 70 分钟，长于当前通用 relay 视频约 12 分钟的主轮询加恢复窗口。因此本 Goal 必须先落实路线图第二批的 Task/Media 结果提交边界和持久恢复语义，再接三个模型参数合同。

## 2. 用户最终得到什么

施工完成后：

1. 图片节点可选择 Nano Banana Pro，支持文生图、1–14 张参考图、10 种比例、1K/2K/4K；
2. 视频节点可选择 Kling V3 Omni，支持文生视频、1–7 张参考图、5/10/15 秒、标准/高品质、16:9/9:16/1:1；
3. 音频节点可选择 Suno V4.5，支持提示词歌曲、自定义歌词歌曲、纯音乐、演唱者性别、采样率和码率；
4. 单节点与整组工作流继续复用现有 Generation Task、Canvas ownership、保存和恢复协议；
5. 服务重启、页面刷新或长时间生成不产生第二次付费提交；
6. 旧 OpenRouter 图片、Ark 视频、Mureka 音频及既有 relay 模型行为不变。

## 3. 方案冻结基线（历史时点）

- 仓库：`/Users/mymy/Documents/unboundry/app`；
- 分支：`codex/unboundry-offline-remediation-2026-08-09`；
- 方案冻结时 HEAD：`e7016eb26ad3a7ae9829067a057b1206d3c2b3c4`；
- package：`0.6.27`；
- 正式工程运行时：Node `22.23.1` / npm `10.9.8`；
- 工作树只允许保留受保护未跟踪文件 `spec/public-templates-director-split-revision.json`；
- 方案冻结时，第一批同步文字 Provider port 已本地完成，状态 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`，尚未发布；
- 方案冻结时线上是 v0.6.27/schema39，状态 `PRODUCTION_PUBLISHED_USER_PASS`；该授权边界只属于当时时点。当前生产和授权边界改由 `spec/UNBOUNDRY_CURRENT_STATE.md` 负责。

当前代码还有一个必须显式修复的目录发现缺口：`server/multiProtocolRelay.ts` 的通用 Gemini 图片正则不能识别 `gemini-3-pro-image-preview`（`3` 与 `image` 之间包含 `pro`），会落入 Gemini 文本分类。必须在通用 Gemini 文本规则之前增加该精确模型的图片分类，并以 m55 固定；不能靠 display name 或模糊品牌猜测兜底。

受保护 JSON 禁止读取、修改、格式化、暂存、提交、移动、删除，也不得进入测试 fixture、构建快照或 artifact。

## 4. 已核实的中转站合同

核实来源：

- `https://hk888vip.com/apidoc#model/gemini-3-pro-image-preview`；
- `https://hk888vip.com/apidoc#model/kling-v3-omni-cankao`；
- `https://hk888vip.com/apidoc#model/suno-v4.5`。

共同合同：

- API base URL：`https://api.lk888.ai`；
- 创建：`POST /v1/media/generate`；
- 请求主体：`model + prompt + params`，可选 `notify_url` 位于顶层；
- 创建成功任务号：`data.task_id`；
- 文档轮询地址：`GET /v1/media/status?task_id=...`；
- 同一文档的 webhook 说明又称返回体与 `GET /v1/skills/task-status` 一致；两条无密钥只读探针均进入鉴权闸门，但尚未证明带密钥时完全等价；
- 状态：`pending / running / success / failed`；
- 终态：`is_final === true`；
- 成功结果：单个 `result_url`、`result_type`、`cost`；
- 文档推荐每 5–10 秒轮询；
- 文档称终态失败自动退款，但示例没有稳定的 `refunded` 字段；
- 文档没有给出取消接口。

未经真实响应证明，不得把文档宣传、价格展示或 `cost` 示例值推断为 Unboundry 可直接入账的货币单位。

## 5. 三个模型的精确合同

### 5.1 Nano Banana Pro

Provider 模型 ID：`gemini-3-pro-image-preview`。

| Unboundry 字段 | Provider 字段 | 规则 |
|---|---|---|
| `aspectRatio` | `aspectRatio` | 精确保留 1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9 |
| `quality` | `imageSize` | `1k → 1K`、`2k → 2K`、`4k → 4K` |
| 参考图片边 | `images` | 按 edge order 形成 URL 数组，0–14 张 |
| `outputCount` | 不发送 | 固定 1 |

输入政策：文本提示词必需；图片参考可选。参考图片允许现有图像 asset，经 owner 校验后生成短期可读引用；持久 task snapshot 只保存 `assetId/kind/role/order/sourceNodeId`，不得保存签名 URL。

首版使用中转站 `media-generate`，不接 Google 原生 `generateContent` 双轨。

### 5.2 Kling V3 Omni 参考生

Provider 模型 ID：`kling-v3-omni-cankao`。

| Unboundry 字段 | Provider 字段 | 规则 |
|---|---|---|
| `aspectRatio` | `aspect_ratio` | 16:9、9:16、1:1 |
| `duration` | `duration` | UI 可存 number；请求严格序列化为 `"5" / "10" / "15"` |
| 新字段 `videoMode` | `mode` | `standard → std`、`quality → pro` |
| 参考图片边 | `images` | 按 edge order 形成 URL 数组，0–7 张 |
| `outputCount` | 不发送 | 固定 1 |

输入政策：文本提示词必需；图片参考可选；不因为名称含 Omni 就擅自开放视频或音频参考，当前文档只证明 1–7 张图片参考。

轮询政策：5 秒起步，允许有界退避至 10 秒；最长核对窗口从真实 Provider boundary attempt 的 `created_at` 计算，不从进程启动或页面打开时间计算。必须完整覆盖文档所述约 70 分钟处理上限，并只增加有限 grace（建议总窗口 75 分钟）；重启后继续使用同一 `providerTaskId`，绝不重新 POST。

### 5.3 Suno V4.5

Provider 模型 ID：`suno-v4.5`。

| Unboundry 字段 | Provider 字段 | 规则 |
|---|---|---|
| 固定模型版本 | `mv` | 固定 `chirp-v4-5`，不在同一模型下暴露旧版本 |
| `lyrics` | `lyrics` | 最长按 Provider 合同与本地字段较小值限制 |
| `musicGenerationMode` | `make_instrumental` | `instrumental → instrumental`；`prompt-song / lyrics-song → song` |
| `vocalGender` | `vocal_gender` | `auto → auto`、`male → m`、`female → f` |
| 新字段 `sampleRate` | `sample_rate` | 44100 / 48000 |
| 新字段 `bitrate` | `bitrate` | 128000 / 192000 / 256000 |
| `outputCount` | 不发送 | 固定 1 |

输入政策：不接受图片/视频/音频参考边。`instrumental` 只要求 prompt；`prompt-song` 要求 prompt；`lyrics-song` 要求 lyrics，prompt 作为风格描述。首版不实现歌词续写、卡拉 OK 字幕下载或多结果。

轮询政策：5 秒起步，最长 15 分钟；达到截止时间后保留 `providerTaskId` 和 paid attempt 证据，转为中性延迟/待核对状态，不允许无证据新建付费请求。

## 6. 目标架构

### 6.1 GenerationResultCommit

新增 Generation 所有的公开应用层接口，建议文件 `server/generationResultCommit.ts`：

```ts
type GenerationResultCommit = {
  commitText(input: TextResultCommitInput): GenerationTask;
  commitMedia(input: MediaResultCommitInput): GenerationTask;
};
```

职责：

1. 验证 taskId、ownerId、kind、executionAttempt、providerTaskId 和 result asset ownership；
2. 成为唯一事务编排者，在同一个 `BEGIN IMMEDIATE`/同一 transaction-scoped DB session 中调用 Media publication port；
3. 完成 `generation_provider_attempts`；
4. 完成 `generation_tasks`；
5. 写入 success event；
6. 任一步失败全部回滚。

禁止：

- Provider adapter 更新 task/media；
- MediaLifecycle 或 MediaRegistry 查询、预留、更新、失败处理、恢复或删除 generation task/attempt；
- 为了拆依赖把原子事务改成事件最终一致；
- 在 Provider 网络请求期间持有 SQLite 写事务。

### 6.2 Media publication token

Media 模块负责媒体自身的 reserve、stage、上传/本地落盘、校验和 external-ready，随后返回不可伪造的 publication token/evidence。GenerationResultCommit 是唯一事务编排者，通过 Media 的公开 transaction-scoped port 在同一 DB session 内原子发布；Media port 和调用者均不得另开嵌套事务。

需要移走 Media 生命周期中的全部 generation SQL，而不只是 `finalizeMediaPublication`：包括 reserve、finalize、fail、startup recovery join，以及 MediaRegistry 删除前的 generation task 查询。相应的归属/可删除性查询由 Generation 的公开 query/port 承担。Media 自己的上传、播放列表等非 generation 来源继续使用 standalone 流程，不得被迫依赖 Generation。

生成媒体保存函数应返回 `assetId + publicationToken`，不能在内部直接把 Generation Task 置为 success。因此允许对 `assetStorage.ts`、`videoStorage.ts`、`audioStorage.ts` 做直接必要的最小签名调整；这属于第二批所有权修复，不是 Storage backend 第三批。

### 6.3 TaskStore 与 Safety 循环

将 `generationProviderAttemptCounts` 迁到不反向依赖 TaskStore 的 Generation query/port 文件。依赖方向变为：

```text
generationTaskStore -> generationSafety -> generationAttemptQueries
```

不得通过动态 import、复制 SQL 或把 Safety 逻辑搬回 TaskStore 伪装消除循环。

### 6.4 Relay media model contracts

新增一个小型、声明式合同表，建议 `server/relayMediaModelContracts.ts`。它不是新的 Provider registry，只负责现有 `media-generate` 协议下模型级差异：

```ts
type RelayMediaModelContract = {
  capability: "image" | "video" | "audio";
  modelId: string;
  mapParameters(...): Record<string, RelayMediaParamValue>;
  referencePolicy: ...;
  pollPolicy: { initialMs: number; maximumMs: number; deadlineMs: number };
  resultKind: "image" | "video" | "audio";
};
```

三个模型必须从这里取得参数映射和轮询政策，禁止在 `executeImageTask/executeVideoTask/executeAudioTask` 中新增品牌判断。未登记模型继续走现有通用 relay 映射，旧行为不变。

## 7. 异步付费与恢复不变量

1. 真正发起 POST 前必须先记录 provider-boundary attempt；
2. POST 一旦返回 task_id，必须在开始轮询前原子绑定到 task 和对应 paid attempt；
3. 响应丢失但可能已提交时，进入 outcome-unknown/usage-record recovery，不直接新 POST；
4. 有 providerTaskId 时，重启、页面刷新、重新调度只能 inspect 原任务；
5. 截止时间由 paid attempt `created_at` 推导，不能因重启延长；
6. 只有明确的 Provider 终态失败且有可机器验证的退款证据，才允许走现有一次自动付费重试；
7. 文档文字“失败自动退款”不等于响应中的退款证据；没有 `refunded: true` 时保持中性失败；
8. 没有取消接口时，用户停止只停止本地后续轮询/工作流，不得声称远端已取消或退款；
9. 轮询地址兼容回退只允许在 404/405；401/403/429/5xx/网络错误不得切换地址掩盖问题；
10. 下载、对象落盘和 publication 可重试，但成功推理不能因清理失败被改成 Provider 失败；
11. Provider 返回 `cost` 的货币/积分单位未核实前，不覆盖管理员配置的估算成本，也不编造实际金额。

其中音频必须补齐与图片/视频同等级的“提交响应丢失”处理。若中转站没有可按唯一请求身份安全匹配的 usage record，Suno attempt 必须停在中性 `outcome_unknown` 并等待人工核对；禁止因为音频旧分支缺少恢复查询而重新 POST。

## 8. 分阶段施工

### Stage 0：身份与调用链冻结

- 只读核对 pwd、branch、HEAD、origin/main、status、package、Node/npm；
- 确认只存在受保护 JSON；
- 核对 Media reserve/finalize/fail/recovery/delete、Task complete、relay submit/poll、startup recovery 直接链路；
- 把执行前调用链和字段所有权写入 Checkpoint。

### Stage 1：第二批结果提交边界

- 提取 GenerationResultCommit；
- MediaLifecycle/MediaRegistry 的 reserve、finalize、fail、recovery、delete 全部移除 generation SQL；
- 生成媒体保存返回 publication token；
- 解除 TaskStore↔Safety 循环；
- 先用静态调用图和局部编译反馈完成边界，不在阶段中重复跑完整 runner；最终与模型合同一起执行一次统一定向验证。

Checkpoint 条件：旧 Provider 行为不变、publication 与 task success 仍同事务、没有新 schema、没有真实外部请求。

### Stage 2：声明式模型合同

- 新增三个模型的参数与输入合同；
- 修复 `gemini-3-pro-image-preview` 在 relay model discovery 中被误判为文本的问题；
- 扩展严格 allowlist；
- 新增 `videoMode/sampleRate/bitrate` 参数目录；
- 为三个模型提供 known schema；
- 保留 generic relay 旧模型路径。

### Stage 3：持久长任务恢复

- 按模型合同选轮询策略；
- 从 provider attempt created_at 计算截止；
- Kling 完整覆盖约 70 分钟并加有限 grace（建议总窗口75分钟）；Nano 10 分钟；Suno 15 分钟；
- 服务重启恢复只查同一 task_id；
- 截止后保持可核对证据，不自动重复付费。

### Stage 4：结果与错误规范化

- 严格验证 result_type 与目标 kind；
- 图片只接受当前存储路径能安全验证的 PNG；若真实 Provider 返回其他格式，只登记阻断，不顺手扩图片格式体系；
- 视频 MP4、音频 MP3 走现有有界下载与 publication；
- 404/405 才启用 status path 回退；
- 无退款字段不自动重试；
- 无取消接口不虚构远端取消。

### Stage 5：定向验收与文档同步

- 在全部相关代码完成后，用一次 safe runner 定向命令统一执行 TypeScript、构建与受影响 specs；
- 每个受影响 spec 在最后相关代码修改后最多通过一次；
- 失败时只重跑失败 spec或更小子集；
- 不默认运行 full；
- 同步本计划、验收矩阵、Checkpoint、CURRENT_STATE 与 TASKS 当前区块；
- 创建范围清晰的本地 commit；不 push、不发布。

## 9. 允许修改范围

默认允许：

- `server/generationResultCommit.ts`（新增）；
- `server/generationAttemptQueries.ts`或等价公开 query（新增）；
- `server/relayMediaModelContracts.ts`（新增）；
- `server/generationTaskStore.ts`；
- `server/generationSafety.ts`；
- `server/generationTasks.ts`；
- `server/relayProviderAdapters.ts`；
- `server/multiProtocolRelay.ts`；
- `server/mediaLifecycle.ts`；
- `server/mediaRegistry.ts`；
- `server/assetStorage.ts`；
- `server/videoStorage.ts`；
- `server/audioStorage.ts`；
- `types/modelParameters.ts`；
- 与上述合同直接相关的 m5/m14/m38/m40/m44/m53/m54/m55/m57/m88；
- 必要的新纯合同测试；
- 本方案、矩阵、Checkpoint、TASKS/CURRENT_STATE 当前区块；
- 若新增测试导致冻结清单变化，最小同步安全 runner 清单和 source coverage manifest。

范围外文件只有直接编译或安全 runner 冻结证据确实要求时才允许最小修改，并必须在最终报告说明因果链。

## 10. 明确不做

- 不新增 ProviderDriver；
- 不新增新的 Media Provider registry；
- 不接 Google 原生 generateContent 双轨；
- 不接 webhook；
- 不新增 Storage backend、不迁移 local/OSS 数据；
- 不改 Canvas、Workflow、React 节点或模板；
- 不新增数据库 schema，除非现有 paid attempt created_at 经证明无法承载持久截止；此时必须先记录真实阻断，不得静默迁移；
- 不实现卡拉 OK、歌词续写、多结果、视频/音频参考输入；
- 不修改版本、release、生产配置；
- 不读取或处理受保护 JSON。

## 11. 测试预算

测试遵循风险传播，不按“更保险”扩张：

1. 实现过程中不为“阶段放心”重复跑 runner；全部相关代码落定后只执行下面一次统一定向命令，safe runner 自带 preflight、TypeScript、构建、临时数据、动态 loopback 与外网门禁；
2. 统一集合覆盖 Stage 1 的 m5/m14/m38/m40/m88，以及 Stage 2–4 的 m44/m53/m54/m55/m57；模型合同优先补进这些直接 spec，只有职责明显不属于现有 spec 时才新增一个集中合同 spec并加入同一命令；
3. 推荐最终命令：

```bash
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
```

4. 如果 asset/audio/video storage 签名变化触及既有存储合同，再追加 m37/m80/m87/m90 中有直接断言者；
5. Canvas/Workflow 未修改时，不跑 m22/m41/m68；
6. 不运行默认 `npm run verify`；
7. 只有改动传播到安全 runner 公共入口、schema、跨域高风险合同，且新 Goal 明确要求最终候选全量时，才允许一次 `node scripts/run-safe-tests.mjs full`；当前推荐不跑 full；
8. 自动测试只用新临时目录、动态 loopback 端口和 fake fetch，4173、`app/data`、`/var/lib/unboundry`、真实媒体、真实密钥、OSS、生产请求均为 0。

## 12. 真实 Provider 验证边界

本地工程完成不依赖真实 Provider，可达到 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`。

若新 Session 已获得专用测试凭据并显式启用独立真实 smoke，则最多：

- Nano Banana：1 次文字出 1K 图；
- Kling：1 次文字出 5 秒 std 视频；
- Suno：1 次纯音乐请求；
- 总创建 POST 最多 3 次，任何响应未知、超时或失败均禁止自动重试；
- 轮询 GET 不计创建次数，但必须有截止；
- 真实 smoke 不能使用 app/data、生产库或生产 4173；
- 没有专用凭据时标记 `REAL_PROVIDER_SMOKE_PAUSED`，不阻断本地工程 Goal 完成。

## 13. 本地 commit 安排

推荐两个独立本地 commit：

1. `refactor(generation): own media result commits`
   - 第二批边界、循环依赖、旧行为测试；
2. `feat(generation): add relay media model contracts`
   - 三模型合同、长任务策略、测试和文档。

不得把受保护 JSON、版本变化、无关格式化或其他功能混入任一提交。未经新授权不 push、不提 PR、不打 tag、不发布。

## 14. 完成定义

只有同时满足以下条件才可写 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`：

1. MediaLifecycle/MediaRegistry 不再查询或更新 generation task/attempt；
2. GenerationResultCommit 保持 publication、attempt、task、event 同事务；
3. TaskStore↔Safety 无运行时循环；
4. 三个模型均经过同一现有 `media-generate` transport；
5. 参数、输入数量、轮询截止和结果类型均有直接 fixture 断言；
6. Kling 70 分钟语义通过时间注入测试，不真实等待；
7. 重启恢复、丢响应、迟到结果、保存失败、取消均不重复创建 Provider 任务；
8. 无明确退款字段时不自动付费重试；
9. 定向测试有命令、运行时、隔离环境、退出码和请求数证据；
10. 受保护 JSON、4173、真实数据、OSS和生产均未触碰；
11. 文档、矩阵、Checkpoint、TASKS/CURRENT_STATE同步真实状态；
12. 本地提交边界清楚，未自动进入发布阶段。

## 15. 2026-08-21 本地施工回执

- 路线图第二批已完成：`GenerationResultCommit`成为Generation拥有的事务编排者；Media publication只产出并消费transaction-scoped evidence，不再查询或更新Generation task/attempt；TaskStore与Safety运行时循环已解除。
- 三模型已登记在小型`relayMediaModelContracts`中，未登记模型仍走generic relay路径；没有新driver、平行Media registry、Google原生图片双轨、Storage backend或schema。
- Nano：10种比例原样、1K/2K/4K映射、最多14张按edge order的`reference-image`；Kling：3种比例、字符串5/10/15秒、std/pro、最多7张图片；Suno：`chirp-v4-5`、三种歌曲模式、auto/m/f、采样率与码率，不接受媒体边。
- 截止从paid attempt `created_at`计算：Nano 10分钟、Suno 15分钟、Kling 75分钟；5秒起步且最多10秒。已有`providerTaskId`只轮询原任务；提交响应丢失保持outcome-unknown/人工核对，不二次POST。
- 状态路径只在404/405回退；严格核对`result_type`；图片验证PNG、视频走MP4、音频走现有格式；Provider `cost`未覆盖本地可信估算；没有`refunded:true`不自动付费重试。
- 当前定向最终有效证据为十个spec `148/148`；完整命令、分次故障诊断和隔离回执见验收矩阵第11节。未跑full，未做真实Provider smoke（`REAL_PROVIDER_SMOKE_PAUSED`）。
- 第一提交为`3144d7a refactor(generation): own media result commits`；第二提交使用冻结消息`feat(generation): add relay media model contracts`并包含模型合同、直接测试、runner清单同步及本文档回执。
