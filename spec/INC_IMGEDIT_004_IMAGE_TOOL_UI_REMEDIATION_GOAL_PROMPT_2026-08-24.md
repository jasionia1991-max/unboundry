# INC-IMGEDIT-004 新 Session 单 Goal 提示词

> 复制下面代码块到新 Session。必须亲自填写具体版本号和独立发布句子；若暂不填写，Goal 仍连续完成 R0～R7，但必须停在 R8 前。

```text
/goal

继续 Unboundry 项目，执行 INC-IMGEDIT-004 图片工具交互与 UI 一次性返工单 Goal。

项目真实 Git 仓库：
/Users/mymy/Documents/unboundry/app

这是一个长任务，必须严格由项目文档、Checkpoint 和实时 Git 驱动。聊天记忆、自动摘要、旧 Goal 和历史授权都不是施工事实源。上下文压缩、换 Agent 或自动续跑后，必须停止编辑、重新完整阅读、核对 Git，只从 INC-IMGEDIT-004 Checkpoint 的“唯一下一动作”继续。

【本 Goal 的发布门】

版本号确认：__USER_FILL_EXACT_VERSION__
允许发布：__USER_FILL_EXACT_RELEASE_SENTENCE，例如“按 v0.6.36 上线吧”__

如果任一行没有替换成明确内容：
- 仍必须连续完成 R0～R7、全部代码、测试、浏览器验收、本地 checkpoint commits、候选冻结和文档收口；
- 不得自行选择版本号；
- 不得 push、PR、merge、tag、SSH 或生产发布；
- 必须在 R8 前停下并报告缺失的发布门。

【开始前按顺序完整阅读】

1. /Users/mymy/Documents/unboundry/app/AGENTS.md
2. /Users/mymy/Documents/unboundry/app/上线规矩.md
3. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_CURRENT_STATE.md
4. /Users/mymy/Documents/unboundry/app/README.md
5. /Users/mymy/Documents/unboundry/app/TASKS.md 顶部当前区块
6. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_PLAN_2026-08-24.md
7. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_CHECKPOINT.md
8. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md 顶部及 IMGEDIT-001～028
9. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md
10. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md，重点第8节图片高级编辑
11. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md
12. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_CHECKPOINT.md 顶部、D13和预算账本
13. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md
14. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md
15. /Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md
16. /Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_GOAL_PROMPT_2026-08-24.md

如果 AGENTS.md 规定额外阅读顺序，继续完整阅读，不得缩减。

【第一步只做只读核对】

- pwd
- git branch --show-current
- git rev-parse HEAD
- git status --short
- git fetch origin main --prune
- git rev-parse origin/main
- git log -5 --oneline --decorate
- node --version
- npm --version
- 读取 package.json 版本
- 核对计划、Checkpoint、矩阵、TASKS 和 CURRENT_STATE
- 核对是否有其他工作树/Agent修改相同文件
- 核对受保护 JSON 仍未跟踪且不进入任何 diff/stage
- 如需陈述生产状态，再实时只读检查 version/live/ready

文档立项参考是 origin/main f369d1d、package 0.6.35、生产 v0.6.35/schema39；这些只用于识别漂移，实际以新 Session 的实时 Git 和文档为准。不得为了匹配旧值 reset、clean 或覆盖用户数据。

只读核对后先用大白话报告：实时基线、工作树、版本门、发布门、Provider预算和阻断情况；随后立即把 R0 写为 IN_PROGRESS 并连续施工。

【Goal 总目标】

一次性解决 v0.6.35 图片工具的交互与 UI 问题：
- 单一活动图片工具状态机，禁止多工具叠层；
- 统一 Portal/screen-space ImageToolHost；
- modal、popover、透明图片 surface 共享壳层；
- 多角度、调整像素、快速切分、增强、抠图、Seedance 面板不裁切、不碰撞；
- 重绘、擦除、扩图、标注、裁剪、全屏形成合格的大型编辑层；
- 透明 PNG 在节点、编辑器和全屏统一显示棋盘格；
- Escape、焦点循环/返回、键盘、中文输入、busy、错误和 reduced-motion；
- 1280×720、1440×900、1728×900 和 zoom 0.15/0.85/1.0/1.5；
- 逐工具自动、浏览器和生产零付费验收；
- 文档、候选以及在发布门有效时的 GitHub/生产交付。

顶部400×48工具栏、更多菜单、颜色标记、既有裁剪安全Blob、下载、Generation/Media/Canvas/Library/Provider数据链必须回归保护。图片打光继续 IMGEDIT-007 / PAUSED。

【严格执行 R0～R9】

R0 实时恢复与缺陷基线；
R1 状态机和共享宿主合同；
R2 单一活动工具与 Portal 宿主；
R3 紧凑面板和快速切分；
R4 大型编辑器与透明舞台；
R5 全屏与交互完整性；
R6 逐工具功能与回归验证；
R7 候选冻结与独立审查；
R8 GitHub与生产发布，仅在两项发布门有效时；
R9 生产零付费验收与用户复验。

同时最多一个阶段 IN_PROGRESS。每阶段完成后必须先更新 Checkpoint、验收矩阵和 TASKS，候选/版本/GitHub/生产事实变化时更新 CURRENT_STATE，然后才能进入下一阶段。

【实现硬合同】

- 用单一 ActiveImageTool/descriptor 取代互不知情的多个 open 状态；
- 打开一个工具必须原子关闭旧工具、更多菜单和颜色菜单；
- modal 打开后底层 Canvas、节点、Creator 和 toolbar 必须 inert；
- ImageToolHost 只负责 UI 宿主、互斥、焦点、关闭、z-index和viewport，不负责业务编排；
- 重型编辑器通过 Portal 固定在 screen-space；
- popover 必须支持 flip/shift/clamp，底部动作永远可见；
- 快速切分使用大型安全壳层，不再挂在节点底部；
- 透明图片统一用棋盘格 Surface，棋盘格不得进入导出字节；
- ImageNode 不新增 fetch、Provider、轮询或上传编排；
- 不修改既有 Provider/Generation/Media/Canvas/Library 业务合同，除非测试证明存在本 Goal 直接相关缺陷；
- 不建立新的大 ImageToolController，不借机全站改版。

【UI 硬合同】

- 只使用项目 14px/12px 两档字号和灰阶视觉；
- 顶部图片工具栏继续400×48、9个40×40按钮、现有顺序、pill和blur16；
- 更多菜单继续约238×272、圆角16、32px行高和既有顺序；
- 多角度约600×308并响应式保持动作可见；
- 重绘/擦除使用大型棋盘格编辑区、紧凑顶部工具条和独立底部Prompt区；
- 标注使用大画布、紧凑图标和tooltip，不用长文字按钮铺满；
- 扩图明确原图与新增边界，控制区可换行；
- 调整像素/增强/抠图/Seedance使用360～420px统一紧凑面板；
- screen UI不随Canvas zoom缩放；
- Escape关闭最上层、焦点返回触发按钮；focus-visible、IME、reduced-motion必须验收；
- 全屏必须是产品内modal，不调用浏览器Fullscreen API。

【本 Goal 授权】

我明确授权你在本 Goal 范围内：
- 修改代码、测试、脚本、配置、文档、package/lock和必要依赖；
- 创建/使用 codex/ 专用分支或隔离worktree；
- 创建阶段性本地 checkpoint commits；
- 自行完成普通设计选择、重构、测试修复、浏览器验收和CI修复，不得中途向我询问普通权限；
- 两项发布门有效且R7通过后，执行最终commit、push、PR、CI、review、merge、tag、SSH、备份、release和原子发布；
- 只读检查生产version/live/ready和已存在验收图片；
- 安全清理本Goal精确创建并核实身份的临时目录、动态端口和本地测试资源。

本授权不允许：
- 读取、输出或提交密钥；
- 新增真实Provider请求、付费生成或视频生成；
- 修改用户历史生产项目、删除历史Media/OSS、删备份或旧release；
- 无备份修改生产schema；
- 购买服务、注册账号或改变云权限；
- 自动声明USER_PASS；
- 用“全部授权”替代具体版本号和独立发布句子。

【真实调用预算】

本 Goal 的真实Provider成功请求、尝试次数和费用上限均为0。INC-IMGEDIT-003的6/6、60 USD已经用完，不得复用。所有生成式UI使用fake、已有结果和零请求浏览器检查。若确实发现必须改变Provider协议且没有零请求证明方法，先把BLOCKED证据写入Checkpoint；禁止自行付费重试。

【测试纪律】

- Node 22.23.1、npm 10.9.8；
- 使用 node scripts/run-safe-tests.mjs；
- 测试只用新临时目录和动态loopback，禁止4173、app/data、/var/lib/unboundry、真实Provider/OSS/媒体；
- 每阶段先跑最小受影响范围；不重复已成功且树未变的测试；
- 测试失败先诊断并复验最小失败集合；
- 候选冻结后最多一次safe full，除非新的相关变更或失败证明必须再跑；
- 修改测试/runner/validator时按项目规则同步source coverage manifest；
- 记录真实命令、环境、范围、结果和退出码；定向不得写成全量。

【逐项验收】

必须覆盖IMGEDIT-021～028，并实际检查：
- 任意工具切换序列中活动工具精确为0或1；
- 背景toolbar/Creator在modal中不可交互；
- 所有面板和动作区在三个目标视口内；
- 四档zoom不改变screen UI尺寸；
- 9:16、16:9、1:1和透明PNG；
- 多角度、调整像素、快速切分、增强、抠图、Seedance；
- 裁剪、重绘、擦除、扩图、标注、全屏；
- Escape、外点、关闭、Tab、Shift+Tab、焦点返回、IME、busy和错误；
- 本地工具零Generation/Provider；生成式UI零真实提交；
- 顶部工具栏、更多菜单、颜色、裁剪、下载无回归。

【不得中途停下】

普通设计选择、代码复杂、类型错误、测试失败、响应式调整、局部重构、浏览器定位、CI普通失败、阶段完成和上下文压缩都由你自行解决并连续推进。固定流程：调查→补失败证据→修根因→最小复验→浏览器检查→更新断点→继续。

【只有这些是真阻断】

- 最新main或用户已有修改无法安全隔离；
- 受保护文件冲突；
- 必须修改生产数据/schema且备份回滚无法证明；
- 必须新增真实付费请求；
- GitHub或生产基础设施出现无法自行修复的外部故障；
- 缺具体版本号或独立发布句子时进入R8；
- 方案会破坏既有Generation/Media/Canvas数据合同且没有安全替代。

阻断时先把原因、证据、已尝试方案、恢复条件和唯一下一动作写入Checkpoint，再报告。不得用弱实现、禁用按钮或截图冒充完成。

【最终状态】

工程理想终态：
LOCAL_ENGINEERING_COMPLETE
TARGETED_AUTO_PASS
VIEWPORT_MATRIX_PASS
LOCAL_BROWSER_PASS
SAFE_FULL_PASS
PR_MERGED
PRODUCTION_PUBLISHED_AUTO_PASS
USER_QUALITY_RECHECK

USER_PASS必须等待我在生产实页明确确认。

现在先完成只读核对和大白话基线报告，然后立即把R0写入Checkpoint并连续执行，不自动启动任何历史任务。
```
