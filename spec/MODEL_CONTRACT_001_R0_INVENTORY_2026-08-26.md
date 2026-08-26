# MODEL-CONTRACT-001 R0 全量只读盘点

状态：`R0_COMPLETE / GOAL_ACTIVE / PROVIDER_POST_0`

日期：2026-08-26

## 1. 实时身份

- 施工工作树：`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`
- 分支：`codex/model-contract-001-2026-08-26`
- 基线：`HEAD = origin/main = 7b475416a77cdee8d7b04ce965600551aa16858c`
- 基线 tree：`eb0882df4f729f4cf4893e652168f7fd1cc46dbc`
- 基线package：`0.6.47`；本Goal自动选择的候选：`0.6.48`；schema保持`41`
- 普通工具链：Node `25.9.0` / npm `11.12.1`
- safe/release兼容通道：Node `22.23.1` / npm `10.9.8`
- 生产：`v0.6.47`，`/opt/unboundry/releases/v0.6.47-governance-node25-20260826`，Node `22.23.2` / npm `10.9.8`，service active/enabled，`NRestarts=0`
- 4173既有监听：PID 21403，旧`/Users/mymy/Documents/unboundry/app`的Vite；本Goal不得使用或终止。
- 远端tag与GitHub Release最高正式版本均为v0.6.47；2026-08-26实时检查确认v0.6.48两处均未占用，因此本Goal使用最小下一patch `v0.6.48`，不移动历史tag。

规划工作树中的11份治理同步改动与4份MODEL-CONTRACT-001新文档已按原diff导入；旧工作树、用户未跟踪文件和受保护JSON均未修改、未暂存、未清理。

## 2. 四类生成节点与图片工具

| 范围 | 入口 | 当前执行边界 | R1影响 |
|---|---|---|---|
| Text | `TextNode` / headless executor / `providerGenerationTextRuntime` | OpenAI Chat/Responses、Claude、Gemini、Ark native由代码adapter执行 | task冻结revision；声明式差异编译到既有connector |
| Image | `ImageNode` / `imageGenerationAdapter` | GPT Image同步接口与relay media异步接口；结果统一进入Media publication | 保留GPT Image专用尺寸、输入准备、结果安全链 |
| Video | `VideoNode` / media provider registry | relay media与Ark native异步任务 | GK精确试点；旧task只poll原task ID |
| Audio | `AudioNode` / media provider registry | relay media与Mureka native | 保留Suno既有多结果与Mureka专用协议 |
| 图片工具 | `imageToolDispatcher` / Generation Task | 创意增强、擦除、多角度、扩图、重绘、抠图经GPT Image；原图、mask、prepared input和operation identity已有owner校验 | 把工具身份、source/mask/prepared input纳入task合同快照；不削弱现有ownership与PNG/alpha门 |

非Provider节点Group、Playlist、Storyboard、Probe不纳入模型执行合同。

## 3. 生产已发布模型清单

生产只读查询于2026-08-26执行；未读取密钥，未写数据库，Provider/Generation/OSS请求均为0。

| capability | Provider | provider model | protocol | R0分类 | 依据与处置 |
|---|---|---|---|---|---|
| audio | 云腾 | `suno-v4.5` | media-generate | SPECIALIZED | 已有专用参数/轮询合同；既有多结果必须保留在专用connector |
| audio | 优创 | `doubao-tts-2.0` | media-generate | GENERIC_GUESS | 依赖通用snake_case映射与通用轮询/结果猜测；R4前保持旧运行时 |
| audio | Mureka | `mureka-9` | native | SPECIALIZED | 专用创建/查询/结果；只迁移声明式差异 |
| image | 云腾 | `gemini-3-pro-image-preview` | media-generate | SPECIALIZED | 已有专用参数、最多14张reference-image、轮询合同 |
| image | 优创 | `gpt-image-2` | gpt-image | EXACT | 既有Provider文档快照与专用generation/edit、尺寸表、同步结果合同 |
| text | 火山方舟 | `doubao-seed-2-0-lite-260428` | native | SPECIALIZED | Ark Responses/Files与多模态输入准备是代码拥有能力 |
| video | 火山方舟 | `doubao-seedance-2-0-mini-260615` | native | SPECIALIZED | Ark原生异步任务、素材准备与代际参数继续由代码connector拥有；仅发布声明式快照 |
| video | 云腾 | `kling-v3-omni-cankao` | media-generate | SPECIALIZED | 已有专用参数、最多7张reference-image、轮询合同 |
| video | 优创 | `grok-imagine-video-1.5-preview` | media-generate | SPECIALIZED | 现有代码对单首帧`params.images`有显式例外，但仍使用通用task/status/result解析 |
| video | 优创 | `grok-video-3`（本方案GK-video-3） | media-generate | GENERIC_GUESS | 当前允许first-frame/reference-image/subject并按角色猜字段；与冻结的单首帧精确合同冲突，R3试点 |
| video | 优创 | `kwvideo-v2` | media-generate | UNKNOWN | 当前schema声明首尾帧但通用映射不足以证明正式合同；不得伪造 |

## 4. Provider与connector影响图

```text
ModelParameterSchema + Canvas edge role
              |
              v
resolveNodeInputs / Generation Task snapshot
              |
              v
generationTasks.ts
  |-- TextProviderRegistry --------> OpenAI/Claude/Gemini/Ark code connectors
  |-- GPT Image adapter -----------> generation/edit + reference preparation
  |-- MediaProviderRegistry
       |-- relay media ------------> generic request/status/result guessing
       |-- Ark native -------------> signed native video contract
       `-- Mureka native ----------> specialized music contract
              |
              v
GenerationResultCommit -> Media publication -> Canvas projection/recovery
```

模板发布和旧Canvas最终都经过`ModelParameterSchema`、节点输入角色、task snapshot与恢复路径；合同发布只能做影响检查，不能自动重写模板或历史Canvas。

## 5. 已确认的主要缺口

1. 没有不可变`ModelReleaseRevision`实体，也没有capability/execution/connector原子发布事务。
2. task冻结了部分model/profile/credential信息，但没有完整合同revision、编译hash和状态/结果解析规则快照。
3. relay通用路径按字段白名单加snake_case映射，并允许`task_id/id/data.*`、多种状态名和`result_url/result_urls/outputs.*`；这仍是猜测式合同。
4. 模式选择使用首个匹配role policy，不能证明多模式零命中/多命中均阻断。
5. 4个relay已发布模型仍进入generic path；GK当前角色能力比正式证据更宽。
6. 管理端没有独立合同工作台、草稿CAS、验证、脱敏预览、影响分析、revision历史、回滚与停止新任务。
7. 图片工具已有严格source/mask/prepared/operation ownership，但这些输入尚未由模型合同revision统一描述和冻结。

## 6. 正式文档核验边界

- 优创文档站为JS应用，当前网页抓取只能取得空壳；项目既有受审查快照继续作为GPT Image尺寸合同和GK冻结事实的证据，不把搜索失败补成猜测。
- OpenAI正式API文档确认生成与编辑是不同操作，并支持图片/遮罩输入与结构化输出；不把OpenAI公共协议直接套到第三方relay模型。
- 火山方舟正式API Explorer确认Seedance参数与模型代际相关；Ark签名、原生任务接口和多模态素材继续归代码connector。
- 未找到可核验正式合同的模型保持`SPECIALIZED`或`UNKNOWN`，不升级为`EXACT`。

## 7. R0判定与唯一下一动作

R0完成：四节点、图片工具、11个已发布模型、6个Provider profile、参数schema、输入组装、submit/poll/result/error、模板和恢复路径均已归类。真实Provider POST、控制面请求、Generation、OSS写入与费用均为0。

唯一下一动作：R1先建立失败测试和schema41内的合同底座；旧运行时保持启用。只有不可变revision、原子发布、connector-specific compiler、task合同快照、审计与运行时开关通过后，才进入R2。

## 8. 实施后的处置注记

R0表格保留盘点当时的真实分类，不回写历史。当前候选已将`grok-video-3`升级为有正式证据且唯一代码准入的`EXACT/declarative`合同；`doubao-tts-2.0`由既有显式代码映射承担，发布为`SPECIALIZED/specialized-code`；`kwvideo-v2`仍为`UNKNOWN`，但发布的是不可执行`blocked`快照，目录和新任务均阻断，不再把UNKNOWN伪装成通用可执行合同。
