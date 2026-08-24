# INC-IMGEDIT-005 图片工具产品质量拒收返工方案

> 状态：`PRE_EXECUTION_PLAN / NOT_STARTED / USER_REJECTED_BASELINE`
>
> 日期：2026-08-24
>
> 适用仓库：`/Users/mymy/Documents/unboundry/app`
>
> 施工工作树：`/private/tmp/unboundry-inc005-review-otSo4O`
>
> 分支：`codex/inc-imgedit-005-user-rejection-2026-08-24`
>
> 建档基线：`a4bb48c60dc7f62b23f4ca776da47f7931ba6e6f`
>
> 当前生产：`v0.6.36 / schema39 / TECHNICALLY_HEALTHY / USER_REJECTED`
>
> 候选版本建议：`v0.6.37`，但本文件不构成版本门或发布授权
>
> 实时断点：`spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_CHECKPOINT.md`

## 1. 立项原因与事实边界

用户在生产实页和本地候选抽查中明确拒收图片工具产品质量。INC-IMGEDIT-004 的自动化、浏览器和生产技术证据作为历史保留，但不能覆盖下列真实问题：

1. 快速切分把不可见透明填充或预览留白纳入网格，切分区域没有严格绑定图片有效内容；
2. 图片放大、编辑器和全屏把棋盘格铺成整块黑灰小框背景，透明提示与产品舞台混淆；
3. 扩图范围、提示词、准备图、蒙版和最终生成参数之间的关系在界面和结果节点中不可核验；
4. 图片工具多处展示无价值的“预计 XX USD/CNY”；
5. 图片全屏缺少 TapNow/现有视频详情已有的提示词、模型、尺寸、比例、文件信息和来源信息；
6. 扩图、增强、擦除、抠图、多角度及其他派生结果使用固定坐标，连续执行会覆盖已有节点；
7. Seedance 工具当前只有本地技术预检，却容易被理解为已经完成方舟远端或可信素材校验；
8. 擦除、重绘、扩图、保守增强、创意增强等功能没有在产品语义上清楚区分本地处理与大模型生成；
9. 先前 review 只证明狭窄合同，没有逐工具证明产品语义、参数真实性、输出位置和全屏信息完整性。

当前工作树已有一组未提交的拒收后本地修正。它们只作为待审输入，不得继承 `PASS`；执行本方案时必须逐项核对、保留正确部分、修正错误部分，并重新形成候选证据。

## 2. 目标与非目标

### 2.1 本次必须达到的目标

- 顶部九项和“更多”八项逐一完成代码、UI、数据、自动化和浏览器 review；
- 快速切分只处理图片真实有效内容，舞台、`contain` 留白和棋盘格永不进入切分坐标；
- 透明 PNG 在节点、编辑器和全屏中使用一致但克制的透明提示；
- 图片全屏具备合格的素材详情面板；
- 所有派生结果通过统一画布放置合同寻找空白区域；
- 扩图的范围、准备输入、蒙版、Prompt、模型和质量可从 UI 一直追踪到请求及结果节点；
- 移除图片工具面向用户的生成前预计金额；
- Seedance 明确拆分本地预检、Provider 可访问性和可信素材状态；
- 明确每个工具由本地浏览器、现有服务端还是生成模型完成；
- 三目标视口、四档 Canvas zoom、横竖方图和透明 PNG 全部通过；
- 测试和验收不发起真实 Provider、付费生成、视频生成或真实 OSS 测试写入。

### 2.2 不在本次范围

- 图片打光 `IMGEDIT-007` 继续 `PAUSED`，只检查入口不会冒充可用；
- 不新增本地 LaMa、rembg、OpenCV inpainting 或其他重型图片引擎；
- 不更换既有 GPT Image 或 Seedance Provider 商业协议；
- 不修改生产 schema、用户历史项目、媒体、OSS、备份或旧 release；
- 不借机重做全站 UI；
- 不建立新的巨型 `ImageToolController`；
- 不把估价 UI 的删除扩大为删除后台真实账单、消费记录或费用保护；
- 不用真实生成请求证明 UI 或协议。

## 3. 产品与架构硬合同

### 3.1 共享宿主继续保持纯 UI 职责

`ImageToolHost` 只负责互斥、Portal、screen-space、焦点、关闭、inert、z-index 和 viewport。结果放置、Provider 调用、媒体上传、轮询、Canvas 持久化继续由既有端口和小 use case 负责。

### 3.2 统一派生结果放置端口

建立小型画布放置合同，例如 `CanvasPlacementPort.findVacantRect`，输入为：

- 当前 graph 全部节点矩形；
- 源节点矩形；
- 单节点或整组结果的目标外接矩形；
- 安全间距；
- 当前 viewport（只用于优先级，不写入业务数据）。

规则：

1. 首选源节点右侧；
2. 碰撞时按右、下、左、上的扩展环搜索；
3. 单节点和整组批量结果使用同一碰撞规则；
4. 快速切分、多角度等批量结果先计算组内布局，再以整组外接矩形找空位；
5. 连续执行同一工具不得产生同坐标结果；
6. 不改变既有节点位置，不自动重排用户画布；
7. 放置结果必须是可持久化的 Canvas world-space 坐标，不受 screen zoom 影响。

禁止继续在各 use case 中复制 `source.x + source.width + 140`。

### 3.3 统一图片详情合同

图片全屏建立可复用的只读详情模型，展示真实可用字段：

- 标题；
- Prompt；
- 模型；
- 像素尺寸；
- 宽高比；
- 质量；
- 文件大小；
- 来源类型：本地上传、生成、裁剪、调整像素、切分、标注、扩图、擦除、重绘、增强、抠图、多角度；
- 源素材或源节点关系；
- 创建日期（只有存在可靠数据时显示）；
- 下载和关闭。

本地上传显示“本地上传”，本地处理显示“本地处理”，缺失字段显示“—”，禁止伪造模型、时间或 Prompt。全屏继续是产品内 modal，不调用浏览器 Fullscreen API。

### 3.4 透明 Surface 合同

- 普通 modal、工具壳和全屏背景使用项目统一纯灰黑表面；
- 棋盘格只位于图片实际绘制矩形内，并只在需要揭示透明像素时出现；
- 非透明图片不显示棋盘格；
- `contain` 产生的舞台留白不伪装成图片透明区域；
- 棋盘格由 CSS/UI 绘制，永远不得写入导出字节；
- 节点、编辑器、全屏使用同一判定合同。

### 3.5 快速切分有效内容合同

切分必须区分：

1. 编辑舞台边界：永不参与；
2. 原始位图边界：普通不透明图片使用；
3. Alpha 有效内容边界：透明 PNG 默认使用。

Alpha 有效边界由统一函数计算，预览网格与导出必须复用同一结果。2×2、3×3、4×4 输出需要记录每片实际像素尺寸。全透明图片 fail-closed，提示没有可切分内容。

### 3.6 扩图参数真实性合同

扩图 UI 中用户确认的范围必须形成结构化参数，并能从一次操作中追踪到：

- 左、右、上、下扩展量；
- 原始宽高与目标宽高；
- `preparedInput` 的 asset、宽高和版本；
- mask 的 asset、宽高、版本和 feather；
- Prompt；
- 模型、质量、比例及模型参数；
- operation ID、源节点和源素材；
- 结果节点保存的 outpaint 元数据。

不得追加用户不可见的业务 Prompt。系统级安全指令若存在，必须属于 Provider 协议层且不得冒充用户输入。自动测试必须直接断言 request payload 和结果节点数据。

### 3.7 费用展示合同

图片工具 UI 中删除所有生成前“预计 XX USD/CNY”及其占位布局。后台真实账单、结算、任务消费、预算和管理员审计字段保留，不因 UI 删除而改变。

### 3.8 本地与模型处理合同

| 工具 | 真实执行方式 | 产品不得声称 |
|---|---|---|
| 裁剪 | 本地 Canvas + 安全 Blob | 不得声称 AI 裁剪 |
| 调整像素 | 本地 Canvas 重采样 | 不得声称 AI 超分 |
| 快速切分 | 本地 Canvas | 不得声称生成 |
| 标注 | 本地矢量编辑与显式导出 | 不得声称模型改图 |
| 保守增强 | 本地轻量滤镜 | 不得声称去噪、细节恢复或超分 |
| 重绘 | 本地画 mask，GPT Image 类模型生成像素 | 不得声称本地修复 |
| 擦除 | 本地画 mask，GPT Image 类模型修补像素 | 不得声称离线擦除 |
| 扩图 | 本地准备透明扩展图和 mask，模型生成新增区域 | 不得声称纯本地扩边 |
| 创意增强 | 图片生成模型 | 不得与保守增强混淆 |
| 抠图 | 当前图片模型生成透明 PNG | 不得声称本地分割引擎 |
| 多角度 | 图片生成模型 | 不得声称本地几何旋转 |
| Seedance 素材校验 | 本地规则；远端能力另行标识 | 不得把本地通过称为方舟已验证 |

### 3.9 Seedance 三层校验合同

第一层“本地结构预检”：

- owner、storage ready、格式、大小、分辨率、比例、数量、角色和模型配置版本；
- 结果只能写 `LOCAL_PREFLIGHT_PASS/FAIL`，有短期过期时间。

第二层“Provider 可访问性”：

- 验证最终提交给 Ark 的 URL 或 `asset://` 引用形态；
- 普通 URL 只做零费用、只读、受控的可访问性检查；
- 不创建 `/contents/generations/tasks`。

第三层“可信素材状态”：

- 真人可信素材使用方舟官方 `asset://asset_id` 合同；
- 只有官方只读接口和当前 Provider profile 能提供可核验证据时，才显示远端可用；
- 无可靠只读接口时明确显示“将在任务提交时由方舟最终确认”；
- 不伪造 TapNow 内部实现，不把开源项目的本地预检冒充远端资格。

实际 Seedance 生成继续使用既有 Ark 异步任务提交和轮询链路。

## 4. 全工具 review 清单

### 4.1 顶部九项

| 顺序 | 工具 | 本次 review 重点 |
|---:|---|---|
| 1 | 裁剪 | 安全 Blob、加载、取消、派生节点放置、透明图、下载字节 |
| 2 | 多角度 | 参数、模型任务、批量结果放置、错误与 busy |
| 3 | 重绘 | mask 坐标、Prompt、模型请求、透明舞台、结果放置 |
| 4 | 图片打光 | 保持 PAUSED，入口不得伪装可用 |
| 5 | 更多 | 238×272、顺序、命中区、viewport、与 Creator/z-index |
| 6 | 颜色 | 菜单互斥、保存、撤销、刷新、筛选 |
| 7 | 素材库 | owner、幂等、删除语义、返回画布 |
| 8 | 下载 | 原始/派生字节、文件名、透明 Alpha、零棋盘格 |
| 9 | 全屏 | 统一详情、透明 Surface、焦点、Escape、下载 |

### 4.2 “更多”八项

| 顺序 | 工具 | 本次 review 重点 |
|---:|---|---|
| 1 | 扩图 | 结构化范围、准备图、mask、Prompt、结果元数据和放置 |
| 2 | 擦除 | mask、模型边界、结果放置、错误与 busy |
| 3 | 标注 | 大画布、工具图标、tooltip、IME、撤销重做、导出 |
| 4 | 增强 | 本地保守与模型创意明确分离、结果放置 |
| 5 | 调整像素 | 精确尺寸、比例锁、本地导出、结果放置 |
| 6 | 抠图 | 模型请求、真实 Alpha、透明显示、结果放置 |
| 7 | 快速切分 | 有效内容边界、网格预览、4/9/16结果与整组放置 |
| 8 | Seedance | 三层状态、角色、模型规则、过期、零生成请求 |

每项都必须检查：打开、切换、关闭、外点、Escape、Tab/Shift+Tab、焦点返回、IME、busy、错误、响应式、输出节点、输出位置、输出元数据和本地/Provider 请求边界。

## 5. 分阶段施工

同时最多一个阶段为 `IN_PROGRESS`。每阶段完成后先更新实时 Checkpoint、验收矩阵和 TASKS；候选、版本、GitHub或生产事实变化时再更新 CURRENT_STATE。

| 阶段 | 内容 | 退出条件 | 初始状态 |
|---|---|---|---|
| R0 | 实时恢复、Git/工作树/现有修正审计、缺陷基线 | 所有当前改动来源和保留/重做决定可追溯 | NOT_STARTED |
| R1 | 冻结共享详情、透明、切分、放置、引擎和Seedance合同；补红测试 | 合同测试精确证明旧缺口 | NOT_STARTED |
| R2 | 图片全屏详情与透明 Surface | 图片详情字段真实、舞台不铺棋盘格 | NOT_STARTED |
| R3 | 有效内容切分与统一空白区域放置 | 单项/批量连续执行无覆盖 | NOT_STARTED |
| R4 | 扩图/重绘/擦除/增强/抠图/多角度数据真实性 | UI→payload→节点可直接断言 | NOT_STARTED |
| R5 | Seedance 三层校验与准确文案 | 本地通过不再冒充远端通过，零生成任务 | NOT_STARTED |
| R6 | 全部17项 UI 与交互 review、移除预计金额 | 所有入口符合项目设计系统 | NOT_STARTED |
| R7 | 定向自动化与本地浏览器矩阵 | 直接受影响测试和三视口/四zoom通过 | NOT_STARTED |
| R8 | 候选冻结、一次 safe full、独立只读 review、用户本地复验 | 候选无阻断，提供验收地址与清单 | NOT_STARTED |
| R9 | GitHub、生产发布与零付费生产复验 | 仅在新版本门和新发布门有效时执行 | NOT_STARTED |

## 6. 验收矩阵增量

| ID | 内容 | 完成标准 | 初始状态 |
|---|---|---|---|
| IMGEDIT-029 | 图片全屏详情 | 提示词、模型、尺寸、比例、质量、文件、来源等真实展示 | NOT_STARTED |
| IMGEDIT-030 | 派生结果空白区放置 | 单项和批量结果不覆盖现有节点，坐标可刷新恢复 | NOT_STARTED |
| IMGEDIT-031 | 快速切分有效内容 | 舞台/contain留白不参与，透明图按Alpha有效边界切分 | NOT_STARTED |
| IMGEDIT-032 | 透明 Surface 语义 | 棋盘格只揭示图片透明像素，不铺满产品背景、不进导出字节 | NOT_STARTED |
| IMGEDIT-033 | 扩图参数真实性 | 范围、准备图、mask、Prompt、模型从UI贯通请求和节点 | NOT_STARTED |
| IMGEDIT-034 | 图片工具无预计金额 | 所有图片工具用户界面无预计USD/CNY，后台账单不变 | NOT_STARTED |
| IMGEDIT-035 | 本地/模型执行方式准确 | 每个工具的真实执行边界与UI语义一致 | NOT_STARTED |
| IMGEDIT-036 | Seedance 分层校验 | 本地、可访问性、可信素材状态分层且零生成请求 | NOT_STARTED |
| IMGEDIT-037 | 顶部9项与更多8项全 review | 17项逐一具备功能、UI、交互、输出和请求证据 | NOT_STARTED |
| IMGEDIT-038 | 候选与用户复验 | 本地候选、生产技术和用户确认严格分层 | NOT_STARTED |

## 7. 自动化与浏览器验收

### 7.1 自动化最低集合

- 图片详情字段映射、缺失字段和本地上传分支；
- 透明/不透明/全透明 PNG 的有效边界；
- 2×2、3×3、4×4 切分像素语义；
- 单节点连续三次和批量整组的碰撞放置；
- 刷新后节点坐标与来源边保持；
- 扩图 structured payload 与结果节点元数据；
- 擦除/重绘 mask、Prompt、model 和 source 身份；
- 保守增强零 Generation，创意增强恰好一个 fake task；
- Seedance 本地预检、过期、角色、远端未知和 trusted asset 分支；
- 图片工具可见文本中不存在预计 USD/CNY；
- Generation/Provider/外网请求守卫为 0。

### 7.2 浏览器矩阵

- 视口：`1280×720`、`1440×900`、`1728×900`；
- Canvas zoom：`0.15`、`0.85`、`1.0`、`1.5`；
- 素材：`9:16`、`16:9`、`1:1`、透明 PNG、透明填充 PNG、全透明 PNG；
- 画布：空画布、普通密度、四周已有节点的拥挤画布；
- 交互：恶意工具切换、Escape、外点、Tab、Shift+Tab、焦点返回、IME、busy、错误、reduced-motion；
- 输出：单节点、4/9/16批量节点、来源边、刷新恢复、下载字节；
- 网络：本地工具零 Generation/Provider；生成式 UI 使用 fake，零真实提交。

## 8. 测试纪律

- Node `22.23.1`、npm `10.9.8`；
- 使用 `node scripts/run-safe-tests.mjs`；
- 只使用新临时目录和动态 loopback，禁止4173、`app/data`、`/var/lib/unboundry`、真实Provider/OSS/媒体；
- 每阶段先运行最小受影响范围；成功且树未变的测试不重复；
- 修改runner/validator时同步source coverage manifest；
- 候选冻结后最多一次safe full，除非新的相关代码变更或失败证据要求精确复验；
- 所有命令记录环境、范围、结果和退出码，定向不得写成全量。

## 9. 版本、Provider与发布门

- 当前生产 `v0.6.36` 的授权已经消费；
- `v0.6.37`只是本方案建议，不是已确认版本；
- 进入 R9 前必须重新获得两条明确内容：

```text
版本号确认：v0.6.37
允许发布：v0.6.37 上线
```

- 真实Provider成功、尝试和费用上限均为0；INC-IMGEDIT-003历史6次/60 USD不得复用；
- 没有新发布门时仍可完成R0～R8、本地提交候选和用户本地复验，但不得push、PR、merge、tag、SSH或生产发布；
- 自动化、Agent浏览器和生产技术通过不能写`USER_PASS`；只有用户在生产实页明确确认才能收口。

## 10. 阻断条件

只有以下情况允许停止：

- 最新main或用户已有修改无法安全隔离；
- 受保护文件冲突；
- 必须修改生产数据/schema且无法证明备份与回滚；
- 必须新增真实付费请求；
- Provider/Generation/Media/Canvas/Library合同会被破坏且没有安全替代；
- GitHub或生产基础设施出现无法自行修复的外部故障；
- R9缺少新版本号或对应发布句子。

阻断必须写明原因、证据、已尝试方案、恢复条件和唯一下一动作。普通类型错误、测试失败、UI调整和局部重构不是阻断。

## 11. 完成与拒绝伪完成

理想工程终态：

```text
LOCAL_ENGINEERING_COMPLETE
TARGETED_AUTO_PASS
VIEWPORT_MATRIX_PASS
LOCAL_BROWSER_PASS
SAFE_FULL_EXECUTED
INDEPENDENT_REVIEW_PASS
PR_MERGED
PRODUCTION_PUBLISHED_AUTO_PASS
USER_QUALITY_RECHECK
```

以下不得冒充完成：

- 只修用户截图中的几个界面；
- 只改预览网格但导出仍切透明留白；
- 结果节点换一个新的固定坐标；
- UI显示扩图范围但请求没有携带；
- 用禁用按钮掩盖功能缺陷；
- 把本地Seedance预检写成方舟已验证；
- 把本地轻量滤镜宣传为AI超分；
- 只给截图、不提供可操作页面和直接数据证据；
- 自动宣称`USER_PASS`。

## 12. 恢复顺序与启动方式

任何新 Session、上下文压缩、换 Agent 或自动续跑后都必须停止编辑，重新完整阅读项目 `AGENTS.md` 要求的文件，再按以下INC顺序阅读：

1. 本方案；
2. `spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_CHECKPOINT.md`；
3. `spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_PLAN_2026-08-24.md`；
4. `spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_CHECKPOINT.md`；
5. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 中 `IMGEDIT-021～038`；
6. `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`；
7. `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md` 第8节；
8. INC-IMGEDIT-003的方案、Checkpoint顶部、D13和预算账本。

本文件建档不等于启动开发。用户明确要求开始本返工后，第一步只能是执行Checkpoint中的只读核对，把R0标为`IN_PROGRESS`，然后从“唯一下一动作”连续推进。
