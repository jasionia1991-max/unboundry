# INC-IMGEDIT-003 图片工具栏剩余能力单 Goal 最终行动方案

## 0. 文档状态

- 日期：2026-08-23
- 仓库：`/Users/mymy/Documents/unboundry/app`
- 立项基线：`main` / `14777b5dc5cf48de8b21b6eb3ee27da45070b537` / package `0.6.33` / 生产 `v0.6.33` / schema39
- 状态：`PLAN_FROZEN / D13_IN_PROGRESS / V0_6_35_PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_SMOKE_0_OF_6 / ACTION_TIME_CONFIRMATION_PENDING / USER_QUALITY_RECHECK`
- 当前阶段：D0～D12已完成；v0.6.35已完成GitHub、完整备份、原子切换与生产技术门。第1项多角度真实请求页面预计10 USD，等待动作时确认；Provider仍0/6、费用0 USD
- 版本：`v0.6.35 / VERSION_GATE_VALID / RELEASE_GATE_VALID`
- 发布候选：`v0.6.35 / SAFE_FULL_1052_OF_1052_PASS / PR_81_MERGED / TAG_FC99101 / MAIN_CC62BFB / TREE_CB13FEF / PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK`
- 本 Goal 授权：用户已于2026-08-24明确确认`v0.6.35`并独立回复“按v0.6.35上线吧”；授权只覆盖共同生成热修及Goal内剩余D13，仍须按Runbook逐门执行

本文档是图片节点顶部工具栏除已完成裁剪和继续暂停打光以外所有剩余能力的主施工方案。后续使用一个新 Session 的单一 Goal 连续执行 D0～D13；阶段只是内部检查点，不拆成多个 Goal，不因普通技术选择、测试失败或阶段完成中途等待用户。

长任务必须以项目文档而不是聊天记忆驱动。事实源按以下顺序使用：

1. 用户最新明确指令和实时 Git；
2. 本方案：冻结目标、架构、风险、步骤和完成定义；
3. `spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_CHECKPOINT.md`：唯一实时施工断点；
4. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`：逐项验收状态；
5. `TASKS.md` 顶部当前区块；
6. `spec/UNBOUNDRY_CURRENT_STATE.md`；
7. `spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_GOAL_PROMPT_2026-08-23.md`：新 Session 授权与恢复协议。

内部记忆、压缩摘要、旧 Goal 和历史授权均不是施工事实源。上下文恢复必须重新读文档、核对 Git 并从 Checkpoint 的唯一下一动作继续。

## 1. 总目标

在一个新 Session 的单一 Goal 中，连续完成图片工具栏剩余功能的工程实现、受影响验证、必要的最小真实技术冒烟、文档收口，以及在获得有效版本号和发布授权后的 GitHub 与生产发布。

目标包括：图片工具应用层最小解耦、颜色标记、调整像素、快速分割、标注与显式导出、个人素材库、多角度、遮罩基础、重绘、扩图、擦除、保守增强、创意增强、主体抠图、Seedance 素材校验，以及下载、全屏和已发布裁剪的回归保护。

打光继续保持 `IMGEDIT-007 / PAUSED`，不属于本 Goal 的功能完成范围。

## 2. 调研依据和 UI 权威

功能定义参考 TapNow、ComfyUI Inpaint/Outpaint/Upscale/Mask Editor、ComfyTV Image Tools、IOPaint、background-removal-js、LibTV Create 和 Seedance 素材前置校验的公开资料。这些资料只用于定义用户心智和交互模式；实际模型、输入格式、计费、Alpha、任务状态和许可证必须在施工时按当前官方资料及 Unboundry 实际 Provider 核实，不能根据竞品界面臆造。

UI 实现必须服从：

- `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`；
- `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`；
- `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`；
- `client/src/canvas/ImageNode.tsx`；
- `client/src/styles.css`；
- 已验收的裁剪方案和生产证据。

## 3. 功能定义冻结

| 功能 | 产品定义 | 执行类型 | 完成要求 |
|---|---|---|---|
| 裁剪 | 改变图片可见边界 | 本地 | 已完成，只回归 |
| 多角度 | 根据当前图片生成指定机位视角 | 生成式 | 真实结构化视角能力 |
| 重绘 | 按遮罩和提示词修改局部 | 生成式 | 真实局部编辑 |
| 打光 | 改变图片光线 | 生成式 | 继续 `PAUSED` |
| 颜色标记 | 节点视觉分类和筛选 | 元数据 | 真实持久化 |
| 保存到素材库 | 保存为个人可复用素材 | 素材库 | 真实安全引用 |
| 下载 | 下载有权访问的真实资产 | 查看器 | 保持现有语义 |
| 全屏 | 产品内模态查看图片 | 查看器 | 保持现有语义 |
| 扩图 | 扩大边界并生成新增区域 | 生成式 | 真实 outpaint |
| 擦除 | 删除遮罩对象并补全背景 | 生成式 | 真实 erase |
| 标注 | 保存可编辑矢量沟通层 | 元数据/本地 | 可保存、恢复和导出 |
| 保守增强 | 提升清晰度、降噪和细节 | 图片处理 | 尽量保持原内容 |
| 创意增强 | 允许模型补充新细节 | 生成式 | 明示内容变化风险 |
| 调整像素 | 精确修改图片宽高 | 本地 | 真实像素处理 |
| 主体抠图 | 移除背景并输出透明 PNG | 图片处理 | 全链路保留 Alpha |
| 快速分割 | 切分为 2×2、3×3 或 4×4 | 本地 | 生成 4/9/16 个节点 |
| Seedance 校验 | 校验素材技术输入资格 | 校验 | 本地预检真实可用 |

明确不做：真实 3D 建模、任意自由旋转、团队素材库、背景替换、标注直接发送 Agent、Seedance 视频生成、法律合规判断、打光解禁，以及任何用弱实现冒充结构化视角、遮罩重绘、扩图或透明抠图的方案。

## 4. 单 Goal 完成定义

### 4.1 工程完成

必须同时满足：目标代码完成；本地功能真实可用；生成式功能使用真实支持的 Provider 或处理引擎；数据生命周期、取消、失败恢复和幂等完成；UI 符合规范；自动测试和架构边界通过；Checkpoint、矩阵、TASKS 和当前状态同步。

### 4.2 真实技术冒烟

每个真实外部操作只证明安全提交、Provider 接受、结果完成、Media 发布、Canvas 挂接、刷新恢复和无重复付费。状态固定为 `REAL_PROVIDER_TECHNICAL_SMOKE_PASS`，不得把单次真实结果写成 `REAL_CAPABILITY_PASS`、质量稳定或 `USER_PASS`。

### 4.3 生产和用户状态

生产技术发布最多收口为 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK`。多角度准确度、未遮罩区域保持、擦除补景、扩图延续、增强保真和抠图边缘质量必须由用户线上判断；只有用户明确确认后才能写 `USER_PASS`。

## 5. 外部能力阻断边界

如果当前 Provider、账号权限、可部署开源引擎和生产资源均无法支持核心功能：

- 不用假实现冒充完成；
- 不开放按钮，不把 Goal 标为成功；
- 记录 `BLOCKED_REAL_CAPABILITY`；
- Checkpoint 写清缺少的模型、账号、权限、算力、许可证或外部条件，以及已安全尝试的替代方案。

Seedance 没有官方远端资格接口时，只完成并标明本地技术预检，不构成阻断；打光继续暂停也不构成阻断。

## 6. UI 硬契约

- 图片工具栏保持 `400×48`、9 个 `40×40` 操作位、现有顺序、半透明胶囊和 `blur(16px)`；
- 不增加顶层按钮，不改变高度和整体宽度；
- 更多菜单保持 `238×272`、圆角 16、现有 padding、32px 行高和既有顺序；
- 多角度沿用约 `600×308` 面板；
- 重绘沿用最大约 `786.72×440` 编辑区、`385×58` 工具条和 `500×122` 提示区；
- 打光保留约 `602×340` 设计但继续禁用；
- 扩图和快速分割复用裁剪式全屏结构，擦除复用重绘遮罩画布，标注复用大画布结构；
- 调整像素、增强、抠图和 Seedance 校验使用紧凑面板；
- 忙碌态只影响当前操作，错误不能只表现为按钮变灰；
- 支持 Escape、焦点回退、键盘、中文输入法和 reduced-motion；
- 面板按屏幕坐标定位，不随 Canvas 缩放失真；
- 全屏继续使用产品内查看器。

## 7. 架构方案和防耦合门

```text
ImageNode 工具栏和面板
          │
          ▼
ImageToolDispatcher
          │
          ├── SetImageMarkerUseCase
          ├── ResizeImageUseCase
          ├── SplitImageUseCase
          ├── AnnotateImageUseCase
          ├── SaveLibraryAssetUseCase
          ├── SubmitImageEditUseCase
          └── ValidateSeedanceAssetUseCase
                       │
                       ▼
              现有端口/必要新端口
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      Canvas        Generation     Media/Library
                         │
                         ▼
                 Provider/Processor
```

Dispatcher 只路由、阻止重复启动并返回统一结果；不得负责上传、轮询、Provider 映射、Canvas 保存、SQL 或素材生命周期。每个 use case 只依赖实际需要的能力。

优先复用 `CanvasGraphCommandPort`、现有单节点 Generation task port、裁剪安全图片读取链、`GenerationResultCommit`、Provider registry 和架构防火墙。只有现有接口无法表达真实需求时才增加 port。

硬性禁止：

- `ImageNode.tsx` 新增 fetch、任务轮询、Provider 分支或媒体上传编排；
- `CanvasSurface.tsx` 增加按工具名称分支；
- 本地工具创建 Generation task；
- Provider adapter 导入 Canvas、TaskStore、Media 具体实现、OSS 或数据库；
- Media 写 Generation 状态；Library 直接操作 OSS；UI 导入服务端内部实现；
- `generationTasks.ts` 为每项图片功能堆独立大分支；
- 前端维护第二套模型和启用名单；
- 无依据新增跨领域 SQL 或架构例外；
- 用拆文件冒充职责下降。

## 8. 操作级启用和紧急关闭

服务端权威状态为 `available | unavailable | paused | disabled_by_operator | stale`，并返回 operation、reason、modelId、参考图/遮罩/Alpha 支持、输出规格、预计成本和过期时间。前端只消费 DTO。

生产必须能只关闭单项操作。操作级关闭是故障隔离，不是半成品验收捷径。最终发布前，除打光和不存在官方接口的 Seedance 远端校验外，所有目标操作必须 `available`；否则不得把 Goal 标为成功或自动部分发布。

## 9. 数据所有权和失败补偿

| 数据 | 所有者 |
|---|---|
| 节点、派生关系、颜色标记 | Canvas |
| 生成任务、attempt、重试状态 | Generation |
| 媒体、发布、删除意图 | Media |
| Provider profile 和能力 | Provider/Model Catalog |
| 个人素材条目 | Library |
| 遮罩临时附件 | Media 或输入附件应用服务 |
| Seedance 校验结果 | 校验应用层或轻量节点状态 |

本地操作走“安全读取 → 本地处理 → Blob → 登记媒体 → 写派生节点”；只清理能证明未被引用的本轮媒体。异步操作走“ownership 占位节点 → 持久任务 → Provider → Media 发布 → `GenerationResultCommit` → Canvas 回填”；回填失败不得删除已付费结果，必须支持重新挂接。

快速分割必须全部切分成功后再批量登记，并用一个 Canvas 命令提交全部节点和来源边；失败时精确补偿。所有像素操作复用 owner-scoped、same-origin Blob；不得保存签名 URL；遮罩不得以无边界 Base64 进入数据库、日志或错误文本。

## 10. migration 和回滚合同

若需要 schema 变化，只允许 expand-first：新增独立表、可空字段、安全默认值字段和不影响旧程序的索引；不删除旧字段、不改变旧字段含义、不做破坏性原地转换。

新 release 发布后旧 release 必须能在新 schema 上启动；回滚应用版本不要求立即降级数据库；清理和 contract 删除留给后续版本。migration 前必须有冻结备份、临时恢复和演练，并在临时数据库及生产备份副本验证旧版本兼容。

## 11. 标注和素材库专项合同

标注默认保存可编辑矢量文档，不写入原图。施工前测量 100 个图形、1000 个画笔点、中文文字、刷新、自动保存、revision 和撤销性能。Canvas 可承受时保存版本化节点元数据并简化路径；不可承受时保存独立内部资产，Canvas 只留 assetId 和版本。容量阈值必须实测。

素材库施工前审计媒体引用、删除保护、项目/节点/账号删除语义和 migration。个人素材不依赖原节点继续存在，不保存签名 URL；同用户同 asset 默认幂等；删除条目只解除引用，实际媒体删除由 Media 决定；团队素材库继续禁用。

## 12. 状态模型

- 本地和元数据：`unavailable → ready → preparing → success | failed | cancelled`；
- 生成式：`unavailable → ready → preparing → submitting → processing → success | failed | cancelled | stale`；
- 下载和全屏：`idle → preparing → opened | downloaded | failed`。

不同状态必须有不同文案和视觉，不强迫查看器进入完整任务状态机。

## 13. 真实付费与 OSS 验证预算

fake、零请求测试和直接受影响自动门全部通过后，才可真实验证。

| 操作 | 成功请求上限 |
|---|---:|
| 多角度 | 1 |
| 重绘 | 1 |
| 扩图 | 1 |
| 擦除 | 1 |
| 创意增强 | 1 |
| 保守增强（如付费） | 1 |
| 主体抠图（如付费） | 1 |
| 必要兼容复核 | 1 |
| 总上限 | 8 |

每次数量 1、最小可验证分辨率、只用安全测试图片。失败后只有明确未计费且修复直接相关原因时最多补一次；无法判断是否计费时禁止重试。真实 OSS 只用隔离前缀并只删除本 Goal 精确记录的测试对象。

## 14. 单 Goal 详细阶段

### D0：实时基线和文档恢复

完整读权威文档；核对 Git/package/Node/工作树；核对计划、Checkpoint、矩阵、TASKS、当前状态和 Provider/Storage 配置；选择安全分支/worktree；将真实基线写入 Checkpoint。没有明确版本号时保持 `VERSION_UNASSIGNED`。

### D1：合同、矩阵和架构门

冻结 operation、result、capability、状态、错误、数据所有权、真实预算、migration 和操作启用合同；保持 `IMGEDIT-010～020 = NOT_STARTED`；把新增模块纳入架构防火墙；更新 Checkpoint。

### D2：最小图片工具应用层

建立轻量 Dispatcher 和小 use case；接入现有 Canvas、安全图片和 Generation port；保留 revision、ownership、runId、taskId；让裁剪、下载和全屏行为不变；删除被替代的重复编排；运行 TypeScript、架构和最小回归；更新 Checkpoint。

### D3：颜色标记、调整像素、快速分割

完成标记持久化/筛选/撤销；完成宽高、比例锁、资源校验、本地处理和派生节点；完成 2×2/3×3/4×4 预览、批量落图和补偿；证明零 Generation、零 Provider、零真实 OSS；更新矩阵和 Checkpoint。

### D4：标注

先完成容量实验并冻结存储；实现选择、画笔、矩形、箭头、编号、文字、删除、会话撤销重做、路径简化、刷新恢复和显式导出；保持发送 Agent 禁用；验证中文输入和性能；更新矩阵和 Checkpoint。

### D5：个人素材库

审计媒体引用和删除；冻结数据所有权及项目/节点/账号删除语义；如需 schema 只做 expand-first；验证临时数据库、备份副本和旧版本兼容；实现保存、查询、幂等、删除条目、Media 引用和 UI；验证 owner、共享媒体竞态和回滚；更新矩阵和 Checkpoint。

### D6：真实模型和处理引擎调查

核实当前 Provider 和官方模型的多角度、mask、outpaint、erase、增强、Alpha、尺寸、格式、计费与许可证；检查现有 task；建立 fake adapter、能力 DTO 和操作启用。当前 Provider 不足时检查已有其他 profile 或许可证兼容、可部署的本地引擎；仍缺能力则记录阻断。更新 Checkpoint。

### D7：多角度

实现水平、垂直、距离、广角、能力门、成本、ownership 占位、持久任务、恢复、取消、重试、回填和重新挂接；fake 通过后执行一次真实技术冒烟；更新矩阵和 Checkpoint。

### D8：遮罩基础与重绘

建立屏幕/节点/像素坐标；实现画笔、擦除、羽化和预览；创建有上限、可清理、owner-scoped 的附件；实现提示词、参考图、模型预检和重绘任务；覆盖缩放、旋转和高 DPI；fake 通过后真实冒烟；更新矩阵和 Checkpoint。

### D9：扩图与擦除

扩图复用裁剪边界编辑器并提交独立 outpaint；擦除复用遮罩编辑器并提交独立 erase；分别验证原图保持和背景补全，分别做一次真实技术冒烟；不得用普通重绘或调整像素冒充；更新矩阵和 Checkpoint。

### D10：增强与主体抠图

确认真实引擎；判断复用 Generation task 或本地 adapter；只在必要时新增 `ImageProcessingPort`；实现保守/创意增强、变化警告、抠图、棋盘格、PNG 和全链路 Alpha；fake 后按预算冒烟；不伪造 Provider/模型/计费，不建第二套临时任务；更新矩阵和 Checkpoint。

### D11：Seedance 素材校验

复用当前模型参数规则；校验格式、大小、尺寸、比例和角色；绑定 asset/model/role/时间/过期并实现 stale；有官方接口才接远端，没有时明确本地预检；不生成视频；更新矩阵和 Checkpoint。

### D12：冻结候选和统一验证

冻结范围；运行 TypeScript、架构和全部直接受影响测试；覆盖 migration/旧版本兼容、恢复、Media、遮罩、Alpha、启用状态和 UI；运行零真实请求门；完成独立代码/架构/数据/测试审查；修复后只重跑受影响范围；冻结源码后最多一次安全 full；同步所有项目文档。

没有明确版本号时在版本门停止，不得自行分配。获得有效版本后同步 package/lock/runtime/docs，不为版本同步重复 full。

### D13：GitHub 和生产发布

D13 只有在用户明确给出具体版本号并单独写出“允许发布/上线”后执行；“都授权”“继续”“开搞”不能替代两项门。

检查 diff 和受保护文件；commit、push、PR、CI、审查和合并；核对 main/tag/tree；构建精确 artifact；备份；在备份副本验证 migration 与旧版本兼容；新 release 安装、staging、健康和操作启用检查；原子切换；验证 service/nginx/version/live/ready/inventory/静态资源；形成 receipt 和回滚路径；更新为 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK`。

失败时停止切换并回滚旧 release；不强制降级 schema，不冒充成功。

## 15. 测试和证据策略

- 使用 Node `22.23.1`、npm `10.9.8` 和安全 runner；
- 测试只用新临时目录和动态 loopback；禁止 4173、`app/data`、`/var/lib/unboundry`、真实 Provider/OSS/媒体/备份；
- 每阶段只跑最小受影响范围；成功证据不因文档或无关改动重复；
- 失败先诊断并复验最小失败集合；
- 冻结候选最多一次安全 full，除非新相关证据证明必须重跑；
- 修改测试/validator/script 后按项目规则同步 source coverage manifest；
- 自动、真实技术冒烟、生产技术和用户质量证据严格分开。

状态层级：`TARGETED_AUTO_PASS → SAFE_FULL_PASS → REAL_PROVIDER_TECHNICAL_SMOKE_PASS → PRODUCTION_PUBLISHED_AUTO_PASS → USER_QUALITY_RECHECK → USER_PASS`。前一状态不能自动推导后一状态。

## 16. 文档驱动和上下文恢复协议

每完成 D0～D13 的一个阶段，必须在下一阶段前更新：

1. Checkpoint：阶段、diff、测试、预算、风险、阻断和唯一下一动作；
2. 验收矩阵：只更新真实有证据的条目；
3. TASKS：项目级简报；
4. CURRENT_STATE：只有版本、候选或生产事实变化时更新；
5. 本方案：只记录确认的设计偏差和最终实施结果。

同时最多一个阶段 `IN_PROGRESS`，禁止先开下一阶段、以后再补断点。

上下文压缩、新 Agent 或新 Session 恢复时必须停止编辑、重读 Goal 指定文档、只读核对 Git/package/Node/工作树、对照 Checkpoint 的 branch/HEAD/diff/阶段/测试。树未改变时复用有效证据，不为安心重跑 full；不一致时先修正断点或记录阻断；只从“唯一下一动作”继续。

Checkpoint 每次必须包含：时间、阶段、状态、branch/HEAD、工作树摘要、产品/测试/文档文件、schema/version、外部请求和付费预算、测试命令与结果、风险、阻断、回滚点和唯一下一动作。

## 17. 主要风险和应对

| 风险 | 等级 | 应对 |
|---|---:|---|
| Dispatcher 变成上帝对象 | 高 | 只路由，流程拆小 use case |
| Canvas 竞争写入 | 高 | revision/ownership fence |
| 生成成功但节点失败 | 高 | 保留付费结果并重新挂接 |
| 重复扣费 | 高 | attempt、幂等、预算、禁止盲重试 |
| 标注撑大 Canvas | 中高 | 容量实验，必要时独立资产 |
| 素材误删 | 高 | Media 引用和删除保护 |
| migration 破坏回滚 | 高 | expand-first 和旧版本兼容 |
| 快速分割半成功 | 中 | 批次提交和精确补偿 |
| 遮罩错位 | 高 | 像素坐标及缩放/旋转/高 DPI 测试 |
| Alpha 丢失 | 高 | 全链路格式断言 |
| Provider 能力漂移 | 中高 | 服务端权威状态和过期机制 |
| 单项故障拖垮整套 | 高 | 操作级启用和紧急关闭 |
| 第三方引擎不可部署 | 高 | 许可证、体积、算力前置检查 |
| Goal 范围失控 | 高 | 文档检查点、冻结范围、禁止无关重构 |
| 上下文失忆漂移 | 高 | 每阶段强制落档，恢复先读断点 |
| 技术冒烟误当质量通过 | 高 | 保留用户质量验收 |

## 18. 全局停止条件

只有真实执行能力不存在、缺账号/权限/凭证、需要采购、付费状态不明、许可证不兼容、生产资源不能承载、migration 不能兼容旧版本、用户修改无法隔离、受保护文件冲突、备份回滚不安全或外部基础设施无法自行修复时，Goal 才能阻断。

普通测试失败、代码复杂、施工耗时、上下文压缩和阶段完成不是停止理由。

## 19. 最终交付状态

理想终态：

```text
LOCAL_ENGINEERING_COMPLETE
TARGETED_AUTO_PASS
SAFE_FULL_PASS
REAL_PROVIDER_TECHNICAL_SMOKE_PASS
PR_MERGED
PRODUCTION_PUBLISHED_AUTO_PASS
USER_QUALITY_RECHECK
```

用户线上确认后才追加 `USER_PASS`。外部能力不存在时记录 `BLOCKED_REAL_CAPABILITY`，不伪造成功。

## 20. 自我评分

| 维度 | 评分 |
|---|---:|
| 产品定义、UI、架构 | 9/10 |
| 过度设计控制 | 8.5/10 |
| 数据、migration、付费安全 | 9/10 |
| 测试可信度 | 9/10 |
| 文档防漂移 | 9.5/10 |
| 单 Goal 连续性 | 9/10 |
| 本地功能完成把握 | 9/10 |
| 素材库完成把握 | 7.5/10 |
| 生成式功能上线把握 | 6/10 |
| 全部功能一次完成把握 | 7/10 |
| 综合方案质量 | 8.8/10 |

非满分原因是当前尚未证明 Provider 支持所有生成式能力、素材删除生命周期尚待实审、抠图/增强引擎的生产资源适配尚未知，而且用户质量验收不能被自动化替代。

## 21. 当前停点

- V5 最终方案已获用户批准并落档；
- Checkpoint 和单 Goal 提示词已建立；
- `IMGEDIT-010～020` 只登记为 `NOT_STARTED`；
- 产品代码、测试、schema、package、Provider、OSS、GitHub 和生产均未改变；
- 当前无候选、无版本、无有效发布授权；
- 新 Session 必须先执行 D0，不得跳到代码；
- 若要同一 Goal 完成发布，用户粘贴 Goal 前必须填写具体版本号，并保留独立的“允许发布”句子。

## 22. 已确认实施偏差

- D8 不新增任意自由旋转：第3节已明确把它排除在产品范围外，当前 Canvas 也没有图片节点旋转状态；遮罩编辑器按屏幕固定面板和原图像素工作，不随 Canvas zoom 失真。缩放与高 DPI 由 1280×720 原图到 640×360 CSS 框的坐标映射及越界夹取直接覆盖。
- D7/D8 的真实 Provider 技术冒烟统一放到 D13 的精确 v0.6.34 候选环境：本机没有不读取禁区数据即可使用的专用真实 profile，而 GitHub/SSH/生产候选运行按本 Goal 只在 D12 后开放。此前阶段只记 `TARGETED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PENDING_D13`，不拿生产 v0.6.33 的普通生成冒充新代码证据。
- D9 扩图没有复用允许向内裁小的裁剪框，而采用四周等比5%～50%的全屏边界预览：提交前由安全读取链构造透明扩展PNG和同尺寸mask，原图按自然像素原位放入，服务端以独立outpaint参数和准备资产严格核验；这样强制“只扩大、不拉伸、不裁小”。擦除虽复用遮罩画布，但operation、ownership、占位和任务身份均独立。两项真实技术冒烟继续按同一授权顺序留到D13精确v0.6.34候选。
- D10 不引入许可证未闭环的rembg权重或第二套图片任务系统：保守增强冻结为本地同尺寸、确定性的轻量对比度/色彩校正并走派生媒体；创意增强与主体抠图复用既有GPT Image edit和Generation/Media生命周期。主体抠图显式发送`background=transparent`，并在所有结果保存入口解码PNG滤波行、要求至少一个真实非不透明Alpha样本，opaque RGBA也拒绝；棋盘格只属于节点/全屏CSS预览。三项真实Provider技术冒烟继续留到D13精确v0.6.34候选。
- D11 没有接不存在的 Seedance 远端资格接口：实现严格标识的五分钟本地技术预检，复用当前已发布 `seedance-2` 模型的真实参考媒体规则和 owner-scoped Media 元数据；结果绑定 asset/model/role/模型配置revision/时间，过期或身份漂移即 stale。DTO 和 UI 固定说明这不代表远端资格、可生成、质量或法律合规，并保证零视频生成。施工时同时修正 D10 已实现操作在 capability registry 中仍误报不可用的残留。
- D12 冻结候选后只运行一次 safe full：120/120 specs执行，原始 `1048/1052`。未改树精确复验四个失败规格稳定为`102/106`；其中m31揭示图片预检在最终校验前展开返回对象导致`canSubmit`标量失真，产品修正为所有问题追加完成后再生成公开结果；m0/m22/m37只修正异步fixture、fit-view竞争和瞬态状态观测。最终同一四spec `106/106 PASS`，未运行第二次full，也不把原始full改写为1052/1052。
- v0.6.34生产冒烟在Provider前先发现多角度task payload漏传`imageTool`，再由重绘暴露六项生成工具共同写入非法持久顺序0，同时发现源节点1K被模型默认2K覆盖。两次均0 task/0 attempt/0 Provider、费用0 USD。本地热修补齐身份、统一顺序1并继承规范化源参数，m100+m2+m27 `43/43 PASS`。因v0.6.34不可变且授权已消费，用户另行确认v0.6.35并授权上线；新冻结候选`c1a4a08`已完成版本门56/56和唯一一次safe full 1052/1052，下一步按Runbook进入PR/CI，再发布并继续最多6次/60 USD真实技术冒烟。
