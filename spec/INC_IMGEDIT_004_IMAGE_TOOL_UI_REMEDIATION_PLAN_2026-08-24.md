# INC-IMGEDIT-004 图片工具交互与 UI 一次性返工方案

## 0. 文档状态与事实源

- 日期：2026-08-24
- 仓库：`/Users/mymy/Documents/unboundry/app`
- 立项事实基线：`origin/main=f369d1dba1eef05aebc7f1a443256ceb82778ea0`，package `0.6.35`
- 生产事实：`v0.6.35 / schema39 / PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS`
- 用户质量事实：用户已明确反馈图片工具“几乎都不正常”且未遵守项目 UI 规范；当前没有 `USER_PASS`
- 本方案状态：`PLAN_FROZEN / PRE_GOAL / UI_REMEDIATION_REQUIRED`
- 当前施工状态：尚未启动产品代码施工
- 版本门：`VERSION_UNASSIGNED`
- 发布门：`RELEASE_NOT_AUTHORIZED_FOR_A_NEW_VERSION`
- 真实 Provider 预算：`0`；INC-IMGEDIT-003 的 `6/6 / 60 USD` 已用完且不可复用

本方案只处理 v0.6.35 图片工具的交互壳层、视觉规范和完整真人可用性，不重做已经证明可用的 Generation、Media、Canvas、Library、Provider 或 schema39 数据链。

施工事实源按以下顺序使用：

1. 用户在新 Session 中粘贴的最新 Goal 指令与实时 Git；
2. 本方案；
3. `spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_CHECKPOINT.md`；
4. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 的 `IMGEDIT-021～028`；
5. `TASKS.md` 顶部当前区块；
6. `spec/UNBOUNDRY_CURRENT_STATE.md`；
7. `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`；
8. `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`；
9. `spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_GOAL_PROMPT_2026-08-24.md`。

聊天记忆、自动摘要、旧 Goal 和历史授权不能替代上述文件。上下文压缩、换 Agent 或自动续跑后必须重新读文档、核对 Git，只从 Checkpoint 的“唯一下一动作”继续。

## 1. 已确认问题

2026-08-24 对生产页面进行了不生成、不扣费、不保存、不下载的只读浏览器检查，并对 `origin/main` 源码进行了只读核对。已确认：

1. 图片工具状态分散在多个布尔值和 `localToolOpen` 中，不是单一互斥状态；快速切分、Seedance、裁剪等可以叠开。
2. 多角度、调整像素、快速切分、增强、抠图和 Seedance 使用节点相对 `NodeToolbar`，会受节点位置、Creator、视口边缘和画布状态影响。
3. 多角度、快速切分和 Seedance 在当前生产视口中出现底部裁切，提交或关闭区可能不可见。
4. 重绘和擦除遮罩层过弱，底层 Creator 仍明显可见；提示区与底层 Creator 发生视觉碰撞。
5. 透明图片在重绘/擦除和全屏查看中显示为黑底，无法可靠区分透明区域与黑色内容。
6. 标注使用窄竖图舞台配长文字工具条，没有形成项目约定的大画布和紧凑图标语言。
7. 扩图底部控件挤在一行，层级不清；原图范围与新增区域缺少足够明确的视觉边界。
8. 调整像素的比例锁、取消、提交形成失衡栅格；增强、抠图等紧凑面板与底层 Creator 重叠。
9. 顶部 `400×48` 工具栏、更多菜单和颜色标记基本符合既有基线，必须回归保护而不是整体重做。

上述事实足以判定用户质量复验未通过。INC-IMGEDIT-003 的真实 Provider 技术成功仍然有效，但不能推导 UI、交互或图片质量通过。

## 2. 总目标

在一个新 Session 的单一 Goal 中，一次性完成：

- 单一活动图片工具状态机；
- 统一 screen-space 工具宿主；
- modal、popover 和透明图片舞台的共享壳层；
- 多角度、调整像素、快速切分、增强、抠图、Seedance 的紧凑面板对齐；
- 裁剪、重绘、擦除、扩图、标注、全屏的大型编辑层对齐；
- Escape、焦点循环、焦点返回、键盘、IME、busy、错误和 reduced-motion；
- 1280×720、1440×900、1728×900 以及不同 Canvas zoom 下的视口安全；
- 本地/浏览器/自动验收矩阵；
- 文档、候选、GitHub 与生产交付（仅在新版本号和发布门有效时）。

完成不等于“组件能打开”。每个目标工具必须在真实页面上可看、可关、可操作、不叠层、不裁切，并符合项目已有 UI 规范。

## 3. 明确不做

- 不解禁 `IMGEDIT-007` 图片打光；
- 不新增图片工具或改变既有产品语义；
- 不重写 Provider、Generation、Media、Canvas 或 Library 生命周期；
- 不新增 schema，除非施工中出现无法绕开的真实数据合同，且必须另行记录；
- 不重新执行 INC-IMGEDIT-003 的六次付费冒烟；
- 不购买服务、不注册账号、不改变云权限；
- 不修改用户历史生产项目、不清理历史 Media/OSS；
- 不借 UI 返工做无关模块化、全站设计改版或第三种字号；
- 不改变已通过的图片工具栏尺寸、顺序和更多菜单结构。

## 4. 根因修复架构

### 4.1 单一活动状态

图片节点只能有一个活动工具：

```ts
type ActiveImageTool =
  | "crop"
  | "multi-angle"
  | "redraw"
  | "outpaint"
  | "erase"
  | "annotation"
  | "enhance"
  | "resize"
  | "cutout"
  | "split"
  | "seedance"
  | "fullscreen"
  | null;
```

必须通过统一的 `openImageTool`、`closeImageTool` 和活动工具描述符管理。禁止继续增加互不知情的 `xxxOpen` 状态。打开一个工具时必须原子关闭前一个工具和更多/颜色菜单。

活动工具打开后：

- modal 背景必须 inert，底层工具栏、节点和 Creator 不可点击；
- popover 只允许与其触发按钮和自身交互；
- 同时存在的图片工具 dialog/popover 数量必须精确为 1；
- busy 只锁定当前操作，不锁死无关页面；
- 关闭后焦点返回触发按钮。

### 4.2 统一工具宿主

建立最小共享 UI 边界，不建立新的大控制器：

```text
ImageNode toolbar
      │ open/close descriptor
      ▼
ImageToolHost (Portal, screen-space)
      ├── ImageToolModal
      ├── ImageToolPopover
      └── ImageToolSurface
              │
              ▼
       现有 tool use cases
```

职责冻结：

- `ImageToolHost` 只负责显示层、互斥、焦点、关闭、z-index 和 viewport placement；
- 现有 Dispatcher/use case 继续负责业务动作；
- Host 不上传媒体、不创建任务、不调用 Provider、不写 Canvas；
- `ImageNode.tsx` 不新增 fetch、轮询、Provider 分支或媒体编排；
- 不把所有工具内容塞进一个巨大组件。

### 4.3 三类共享壳层

| 壳层 | 适用工具 | 合同 |
|---|---|---|
| `ImageToolModal` | 裁剪、重绘、擦除、扩图、标注、全屏 | Portal、固定遮罩、焦点循环、Escape、底层 inert、视口内安全区 |
| `ImageToolPopover` | 多角度、调整像素、增强、抠图、Seedance | Portal、screen-space、flip/shift/clamp、最大高与内部滚动、关闭后焦点返回 |
| `ImageToolSurface` | 所有显示透明图片的预览/编辑器 | contain、统一棋盘格、加载/错误/空态，不修改图片字节 |

快速切分虽然不修改 Provider，但内容高度较大，使用 modal 或 viewport-safe 大型 sheet，不再使用节点下方 popover。

## 5. UI 硬契约

所有实现必须服从 `UNBOUNDRY_UI_DESIGN_SYSTEM.md` 和参考目录：

- Canvas 继续纯黑，浮层使用克制深灰，不引入蓝色发光；
- 全界面只用 14px 主字号和 12px 辅助字号；
- 图片顶部工具栏继续 `400×48`、9 个 `40×40` 操作位、padding/gap 4、胶囊和 blur 16px；
- 更多菜单继续约 `238×272`、圆角 16、32px 行高和既有顺序；
- 多角度设计目标约 `600×308`，窄视口允许响应式收缩或内部布局换列，但提交/关闭区必须可见；
- 重绘/擦除目标为大型编辑区、紧凑顶部工具条和独立底部提示区；不得与 Creator 叠放；
- 标注使用大画布和紧凑图标按钮；可访问名称和 tooltip 保留中文，不把长文字直接铺满工具栏；
- 扩图明确标出原图边界、新增边界和实际输出范围；底部控件允许换行或分区；
- 调整像素、增强、抠图、Seedance 使用 360～420px 紧凑面板及统一 header/body/footer；
- 快速切分预览、网格选择和动作区在所有目标视口内完整可见；
- 透明图片在节点、编辑器和全屏查看中统一显示棋盘格；棋盘格永不进入导出字节；
- screen UI 不随 Canvas zoom 缩放；
- Escape 关闭当前最上层临时界面，外点只关闭适用的非 busy popover；
- focus-visible 使用项目灰色焦点环；支持 Tab、Shift+Tab、中文输入和 reduced-motion。

## 6. 分工具完成要求

| 工具 | 必须完成 |
|---|---|
| 工具栏/更多菜单/颜色标记 | 尺寸、顺序、tooltip、菜单、筛选行为回归，无几何漂移 |
| 多角度 | 拖拽、滑杆、重置、成本/能力文案、关闭和提交始终可见 |
| 调整像素 | 宽高、比例锁、非法值、取消和提交形成清晰栅格 |
| 快速切分 | 2×2/3×3/4×4 预览、动作区完整、不可叠开第二工具 |
| 增强/抠图 | 风险文案、主次动作、busy、错误和取消使用统一紧凑面板 |
| Seedance | 模型/角色/预检/过期信息可读，关闭可达，不与其他工具叠层 |
| 裁剪 | 既有安全 Blob、加载、选区和比例行为回归；modal 独占 |
| 重绘/擦除 | 棋盘格大舞台、蒙版坐标准确、工具/Prompt不碰撞、底层 inert |
| 扩图 | 原图/新增区边界清楚，底部控制分区，取消与提交可达 |
| 标注 | 大舞台、紧凑图标、六类工具、中文文字、撤销/重做、导出与状态区 |
| 全屏 | 产品内 modal、contain、透明棋盘格、标题、关闭和下载入口 |

## 7. 验收矩阵

新条目为 `IMGEDIT-021～028`：

| ID | 内容 | 初始状态 |
|---|---|---|
| IMGEDIT-021 | 单一活动工具状态机与叠层阻断 | NOT_STARTED |
| IMGEDIT-022 | screen-space 宿主与 viewport 安全 | NOT_STARTED |
| IMGEDIT-023 | 透明图片统一棋盘格与 contain | NOT_STARTED |
| IMGEDIT-024 | 重绘/擦除/扩图/标注大型编辑层 | NOT_STARTED |
| IMGEDIT-025 | 多角度/调整像素/快速切分/增强/抠图/Seedance 面板 | NOT_STARTED |
| IMGEDIT-026 | Escape、焦点、键盘、IME、busy 与 reduced-motion | NOT_STARTED |
| IMGEDIT-027 | 既有工具栏、菜单、颜色、裁剪、下载回归 | NOT_STARTED |
| IMGEDIT-028 | 目标视口与真人逐项功能验收 | NOT_STARTED |

`AUTO_PASS` 只能证明自动证据；候选实页完成后最多为 `USER_RECHECK`；只有用户明确确认才能写 `PASS/USER_PASS`。

## 8. 测试策略

### 8.1 自动测试

优先扩展直接相关图片节点、Canvas UI、可访问性和安全入口测试，至少覆盖：

- 任意工具切换序列中活动工具精确为 0 或 1；
- toolbar/more menu 在 modal 打开时不可触发第二工具；
- Escape、关闭按钮、外点、焦点循环和焦点返回；
- busy 阻止重复提交但不产生永久锁死；
- 透明节点、重绘/擦除、扩图、标注和全屏棋盘格；
- 1280×720、1440×900、1728×900；
- zoom 0.15、0.85、1.0、1.5 下 screen UI 几何不缩放；
- 9:16、16:9、1:1、透明 PNG、local 和 owner-scoped 同站素材；
- 任一面板和动作区 bounds 都在 viewport 内；
- 本地工具保持 Generation/Provider 请求 0；
- UI 返工不改变 operation payload、task 身份、Media 和 Canvas 业务合同。

### 8.2 浏览器真人验收

使用隔离临时数据、动态 loopback 和安全测试图片逐项点击。必须保存每个工具的截图/bounds/控制台/请求计数证据，并执行工具之间的恶意切换顺序，不只检查初始静态截图。

生产发布后的技术验收只做页面、静态资源、状态、已存在图片和零付费交互检查；本 Goal 默认禁止新的真实 Provider 提交。

### 8.3 测试纪律

- Node 22.23.1、npm 10.9.8；
- 使用 `node scripts/run-safe-tests.mjs`；
- 测试只用新临时目录和动态 loopback，禁止 4173、`app/data`、`/var/lib/unboundry`、真实 Provider/OSS/媒体；
- 每阶段运行最小受影响范围；成功证据不因文档或无关改动重复；
- 失败先修根因并复验最小失败集合；
- 候选冻结后最多一次安全 full，除非新的相关代码改动或明确失败证明必须再跑；
- 自动、浏览器 Agent、生产技术和用户 `USER_PASS` 严格分开。

## 9. 单 Goal 阶段

### R0：实时恢复与缺陷基线

完整阅读权威文档；核对 Git、package、Node、工作树、生产技术状态和受保护文件；在最新 `origin/main` 上建立安全施工分支/worktree；用生产只读观察和本地只读源码重现已登记问题；把实时事实写入 Checkpoint。

### R1：状态机和共享宿主合同

冻结 `ActiveImageTool`、descriptor、modal/popover/surface、焦点、busy、关闭和 z-index 合同；先增加失败测试证明叠层、视口裁切和透明背景问题；更新 Checkpoint、矩阵和 TASKS。

### R2：单一活动工具与 Portal 宿主

实现互斥状态机、统一 open/close、底层 inert、焦点返回和共享 Portal Host；移除被替代的独立开关路径；只验证宿主和既有业务 payload 不变。

### R3：紧凑面板和快速切分

完成多角度、调整像素、快速切分、增强、抠图和 Seedance 的 viewport-safe 布局、header/body/footer、主次动作和错误/busy；快速切分改为大型安全壳层。

### R4：大型编辑器与透明舞台

完成重绘、擦除、扩图、标注、裁剪回归和统一 `ImageToolSurface`；修正棋盘格、contain、透明区、原图边界和工具/Prompt/状态区布局。

### R5：全屏与交互完整性

完成全屏透明棋盘格、产品内 modal、Escape/外点/关闭、Tab/Shift+Tab、焦点循环/返回、IME、reduced-motion 和不同视口/zoom。

### R6：逐工具功能与回归验证

按第6节逐项执行本地浏览器验收；覆盖连续切换、取消、错误、busy 和刷新；确认本地工具零 Provider，生成式 UI 不实际提交；更新矩阵到真实 `AUTO_PASS/USER_RECHECK`，不得提前 PASS。

### R7：候选冻结与独立审查

冻结范围；完成 TypeScript、架构、直接受影响测试、截图/bounds 矩阵、零请求门和独立代码/UI/可访问性审查；修复后只重跑受影响集合；最终树最多执行一次安全 full；同步全部治理文档。

### R8：GitHub 与生产发布

仅在用户明确填写具体版本号并独立写出允许发布句子后执行。完成 diff/受保护文件检查、commit、push、PR、CI、review、merge、tag、精确源码构建、备份、release、原子切换、健康/版本/资源/数据不变门和回滚路径。

### R9：生产零付费验收与用户复验

生产只使用已存在图片做打开/关闭/切换/透明预览/viewport/控制台/请求检查，不提交新的 Provider 操作。技术通过最多记录 `PRODUCTION_PUBLISHED_AUTO_PASS / USER_QUALITY_RECHECK`；用户明确确认后才能写 `USER_PASS`。

## 10. 文档驱动纪律

每个 R 阶段开始前先把 Checkpoint 对应阶段标为 `IN_PROGRESS`。完成后必须先更新：

1. INC-IMGEDIT-004 Checkpoint；
2. 验收矩阵 `IMGEDIT-021～028`；
3. `TASKS.md` 顶部 INC-IMGEDIT-004 区块；
4. `CURRENT_STATE`（只有候选、GitHub、版本或生产事实变化时）；
5. 本方案的实施偏差（只有真实偏差时）。

同时最多一个阶段 `IN_PROGRESS`。上下文压缩后停止编辑，重新完整阅读、核对 Git，只从 Checkpoint 唯一下一动作继续。树未改变时复用有效测试，不为安心重复 full。

Checkpoint 每次必须记录：时间、阶段、状态、branch/HEAD/origin-main、工作树、产品/测试/文档文件、package/schema/version、测试命令/环境/退出码、网络/Provider/OSS计数、风险、阻断、回滚点和唯一下一动作。

## 11. 授权和发布边界

新 Goal 可明确授权代码、测试、脚本、配置、文档、必要依赖、隔离分支/worktree、阶段性本地 commit、最终 commit/push/PR/CI/merge/tag/SSH/发布，但以下门不能被“全部授权”替代：

1. 具体版本号；
2. 独立明确的“允许发布/按该版本上线”句子。

缺任一门时可以连续完成 R0～R7和本地候选，但必须停在 R8 前，不得自行分配版本或发布。

本 Goal 真实 Provider 成功请求和费用上限均为 0。若代码意外改变 Provider/Generation 协议并必须重新冒烟，应记录真实阻断并等待新的明确次数和金额授权，不能复用历史 6 次预算。

## 12. 真实阻断与不停条件

普通设计选择、测试失败、类型错误、UI 调整、响应式问题、上下文压缩、CI 普通失败和阶段完成都不是停止理由，应自行调查、修复、最小复验、落档并继续。

只有以下条件可阻断：

- 最新 main、用户已有修改或受保护文件无法安全隔离；
- 必须修改既有生产数据或 schema 且无法保证备份/回滚；
- 必须产生新的真实付费请求；
- GitHub/生产基础设施出现无法自行修复的外部故障；
- 发布门缺失；
- 发现方案会破坏已发布 Generation/Media/Canvas 数据合同且没有安全替代。

阻断前必须先把原因、证据、已尝试方案和恢复条件写入 Checkpoint。

## 13. 最终完成定义

理想终态：

```text
LOCAL_ENGINEERING_COMPLETE
TARGETED_AUTO_PASS
VIEWPORT_MATRIX_PASS
LOCAL_BROWSER_PASS
SAFE_FULL_PASS
PR_MERGED
PRODUCTION_PUBLISHED_AUTO_PASS
USER_QUALITY_RECHECK
```

只有用户在生产实页明确确认后，才能追加：

```text
USER_PASS
```
