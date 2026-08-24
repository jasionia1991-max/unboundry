# INC-IMGEDIT-005 图片工具产品质量拒收返工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-24（v0.6.37发布门恢复）
- 状态：`LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS / INDEPENDENT_REVIEW_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS / R9_IN_PROGRESS`
- 当前阶段：`R9 GitHub与生产发布 / IN_PROGRESS`
- 权威方案：`spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_PLAN_2026-08-24.md`
- 当前仓库：`/Users/mymy/Documents/unboundry/app`
- 当前隔离工作树：`/private/tmp/unboundry-inc005-review-otSo4O`
- 当前分支：`codex/inc-imgedit-005-user-rejection-2026-08-24`
- 建档 HEAD：`a4bb48c60dc7f62b23f4ca776da47f7931ba6e6f`
- package：`0.6.37`
- schema：`39`
- 生产：`v0.6.36 / TECHNICALLY_HEALTHY / USER_REJECTED`
- 本地候选：功能与版本冻结提交`3bb6fb0`；已完成本地工程、定向、浏览器、独立审查和唯一一次safe full；尚未push/PR/tag/发布
- 候选版本：`v0.6.37 / VERSION_GATE_VALID`
- 发布授权：用户明确“允许发布：v0.6.37 上线” / `RELEASE_GATE_VALID`；一次性授权尚未消费
- 真实Provider/尝试/成功/费用：`0 / 0 / 0 / 0`
- 用户质量：`USER_REJECTED`；没有`USER_PASS`
- 受保护文件：`spec/public-templates-director-split-revision.json`永久禁止读取、修改、暂存、提交、删除或改名

## 1. 唯一下一动作

在已确认v0.6.37 tag/release均不存在且origin/main未漂移后，同步package/lock/runtime/m81和治理文档；运行m38+m81安全定向，冻结并提交精确候选，再执行tag/push/PR/CI/merge与生产发布。

## 2. 阶段状态

| 阶段 | 状态 |
|---|---|
| R0 实时恢复与现有修正审计 | AUTO_PASS |
| R1 合同与红测试 | AUTO_PASS_WITH_RED_EVIDENCE |
| R2 图片详情与透明Surface | TARGETED_AUTO_PASS |
| R3 有效内容切分与空白区放置 | TARGETED_AUTO_PASS |
| R4 生成工具参数真实性 | TARGETED_AUTO_PASS |
| R5 Seedance分层校验 | TARGETED_AUTO_PASS |
| R6 全部17项UI与交互review | TARGETED_AUTO_PASS |
| R7 定向自动与浏览器矩阵 | TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS |
| R8 候选冻结、safe full和独立审查 | COMPLETE / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS |
| R9 GitHub与生产发布 | IN_PROGRESS / VERSION_GATE_VALID / RELEASE_GATE_VALID |

同时最多一个阶段为`IN_PROGRESS`。

## 3. 验收条目

`IMGEDIT-029～037`已具定向自动与本地浏览器矩阵证据；`IMGEDIT-038`达到`LOCAL_CANDIDATE_PASS / USER_RECHECK / RELEASE_IN_PROGRESS`。

## 4. R0 实时恢复与现有修正审计

- 时间：2026-08-24 14:42 +0800
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-005-user-rejection-2026-08-24` / `a4bb48c60dc7f62b23f4ca776da47f7931ba6e6f` / 同一commit
- package / schema / production：`0.6.36 / 39 / v0.6.36 USER_REJECTED`
- 工具链：系统默认Node25.9.0/npm11.12.1不符合项目合同；已确认`PATH=/Users/mymy/.local/bin:$PATH`精确提供Node22.23.1/npm10.9.8，后续命令固定使用该PATH
- 工作树隔离：主工作树只有受保护JSON未跟踪；本隔离工作树没有该文件，diff/stage均未命中。其他worktree没有同范围脏修改；旧独立审查Agent已完成且无写入
- 本地服务：`127.0.0.1:54523`由本Goal既有preview进程PID84514监听，只记录身份，不复用为测试端口
- 保留并重新验证：Alpha可见边界与预览/导出共用、普通工具壳改纯灰、图片自身透明提示、预计费用移除、扩图输入→输出尺寸和可见Prompt、更多菜单z-index与灰阶focus/accent
- 必须修正：图片全屏只有标题/下载/关闭；普通透明上传缺可靠透明标记；所有单结果派生use case固定`source.x + width + 140`，快速切分固定网格；Seedance DTO只有`local-technical-preflight`；工具UI没有完整解释本地/模型处理方式
- 参数事实：扩图范围已通过`outpaint`、`preparedInput`、mask和ownership evidence进入请求及结果节点；本Goal补直接验收，不另加隐藏Prompt
- Provider / OSS / 费用：0 / 0 / 0；没有生产或GitHub动作
- 测试：R0未运行产品spec或full；只完成只读源码、文档和Git审计
- 回滚点：`origin/main@a4bb48c`
- 唯一下一动作：R1补共享合同与旧实现失败证据

## 5. R1 合同与红测试

- 时间：2026-08-24 14:50 +0800
- 状态：`AUTO_PASS_WITH_RED_EVIDENCE`
- 合同：方案第3节已冻结图片详情、透明Surface、有效内容切分、统一空白区放置、扩图参数、本地/模型语义和Seedance三层状态；未改变Provider商业协议
- 失败证据：在既有m2首项加入图片详情面板、提示词、来源、1280×720尺寸和无费用文案直接断言
- 命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts`
- 环境：Node22.23.1/npm10.9.8，动态loopback，临时suite；4173 listener unchanged
- 结果：`10/11 PASS`、退出1；唯一失败为`image-detail-panel`不存在，精确证明旧图片全屏只有标题/下载/关闭。其余10项通过；source/snapshot一致，Provider/OSS/费用0
- 该失败是R2施工前预期红证据，不是阻断；没有运行full
- 唯一下一动作：R2实现图片详情与透明Surface并复验m2

## 6. R2 图片详情与透明Surface

- 时间：2026-08-24 15:08 +0800
- 状态：`TARGETED_AUTO_PASS`
- 产品：图片全屏新增提示词与信息侧栏，真实展示来源、模型、尺寸、比例、质量、文件大小；不存在可靠创建日期时显示“—”。本地上传明确显示“本地上传”，本地/AI工具输出按operation标识
- UI：全屏产品舞台改纯灰黑，棋盘格只允许图片元素自身透明提示类；三列信息在小视口收紧，不调用浏览器Fullscreen API，不显示预计费用
- 失败诊断：首次复验在产品spec前由TypeScript发现漏导入`ImageToolOperation`并退出1；补精确type import后只复验m2
- 最终命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts`
- 结果：`11/11 PASS`、退出0；source/snapshot`35e483d0…aa87`一致，4173 listener unchanged，Provider/OSS/费用0，没有运行full
- 验收：`IMGEDIT-029 TARGETED_AUTO_PASS`；`IMGEDIT-032`完成普通舞台/图片自身规则的定向证据，透明上传持久语义继续在R3/R7浏览器矩阵复核
- 唯一下一动作：R3统一空白区放置并补碰撞证据

## 7. R3 有效内容切分与空白区放置

- 时间：2026-08-24 15:25 +0800
- 状态：`TARGETED_AUTO_PASS`
- 产品：新增纯几何`findVacantImageToolPlacement`，支持父子节点绝对坐标、现有节点矩形、40px安全间距和确定性环形搜索，不移动任何已有节点
- 接入：裁剪、调整像素、标注、保守增强、快速切分、多角度、重绘、擦除、扩图、创意增强和抠图全部取消各自固定坐标；单项在graph update时找空位，批量先计算整组外接矩形再放置
- 切分：继续复用同一Alpha有效边界做SVG预览和4/9/16导出；全透明fail-closed，舞台与contain留白不进入坐标
- 测试：m100在首选位置已占用和连续新增两次时直接断言坐标不同；m2透明400×300/可见200×200继续直接证明2×2输出100×100
- 命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts --spec tests/m2-image-node.spec.ts`
- 结果：`24/24 PASS`（m100 13、m2 11）、退出0；source/snapshot`a6237bf3…63e2`一致，4173 unchanged，Provider/OSS/费用0，没有full
- 唯一下一动作：R4加强参数与处理引擎真实性证据

## 8. R4 生成工具参数真实性

- 时间：2026-08-24 13:52 +0800（系统时钟）
- 状态：`TARGETED_AUTO_PASS`
- 产品：扩图明确展示输入→输出几何，说明范围、原图位置和新增区域随任务提交并由图片模型生成；重绘/擦除明确“本地绘制蒙版，图片模型改图”；多角度显示“图片模型已就绪”；主体抠图明确由图片模型输出透明PNG。保守增强仍是本地轻滤镜，创意增强仍走图片模型
- 参数证据：m100直接捕获扩图/擦除payload，断言operation/operationId/source、Prompt、mask asset/尺寸/版本/羽化、outpaint结构和preparedInput；结果节点直接断言operation、outpaint元数据、prepared asset与来源边。既有同测试继续断言创意增强/主体抠图payload和结果节点，m2继续断言多角度与重绘UI→fake task→结果节点全链路
- 首轮命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts --spec tests/m2-image-node.spec.ts`
- 首轮结果：m100 `13/13 PASS`；m2 `10/11 PASS`，退出1。唯一失败是测试仍期待“能力已就绪”，产品已改为更准确的“图片模型已就绪”；其余23项通过，source/snapshot`ace9d178…c0099b5`一致，4173 listener unchanged
- 精确修正：只把m2对应断言同步为“图片模型已就绪”，没有改产品逻辑；未重复已经通过的m100
- 最终复验：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts`，`11/11 PASS`、退出0；source/snapshot`709910b5…dd2188f`一致，4173 listener unchanged
- 环境与边界：Node22.23.1/npm10.9.8，动态loopback/fresh临时suite；TypeScript、生产build、架构/source coverage/凭据/网络门随safe入口通过；真实Provider/OSS/费用0，没有运行full
- 验收：`IMGEDIT-033 / IMGEDIT-035 = TARGETED_AUTO_PASS`，浏览器与17项全review仍留给R6/R7
- 阻断：无
- 唯一下一动作：R5实现Seedance三层准确状态并复验m100+m2

## 9. R5 Seedance分层校验

- 时间：2026-08-24 13:52 +0800（系统时钟）
- 状态：`TARGETED_AUTO_PASS`
- 产品：Seedance面板固定展示三层状态。第一层只反映owner/storage/格式/尺寸/模型/角色/过期的本地结构预检；第二层Provider可访问性明确为“未执行，当前没有零费用只读远端资格证据，实际提交时由方舟确认”；第三层可信素材明确为“未知，当前没有可核验的asset://可信素材证明”
- 边界：未新增Ark控制面或生成接口，未改变现有异步Seedance生成协议；本地预检通过后第二、三层仍保持not-checked/unknown，不得联动变绿
- 测试：m2直接断言三层初始、通过、过期和刷新恢复状态，busy/Escape/外点/Tab/Shift+Tab保持；请求守卫确认Generation/Provider为0。m100继续直接断言`scope=local-technical-preflight`与`remoteValidationAvailable=false`
- 首轮命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts --spec tests/m2-image-node.spec.ts`
- 首轮结果：m100 `13/13 PASS`；m2 `10/11 PASS`，退出1。唯一失败是旧断言寻找“重新校验”，新本地层准确写成“重新预检”；其余23项通过，source/snapshot`50196c47…6fca6a`一致，4173 listener unchanged
- 精确修正与复验：只把旧断言同步为“重新预检”，随后仅复验m2，`11/11 PASS`、退出0；source/snapshot`2a220fd4…95c50`一致，4173 listener unchanged
- 环境与外部影响：Node22.23.1/npm10.9.8，dynamic loopback/fresh suite；safe附带TypeScript/build/架构/source coverage/凭据/网络门通过；真实Provider/OSS/费用0，没有full
- 验收：`IMGEDIT-036 = TARGETED_AUTO_PASS / BROWSER_MATRIX_PENDING`
- 阻断：无
- 唯一下一动作：R6完成顶部9项和更多8项全review、费用静态/DOM门、透明上传持久语义与最小回归

## 10. R6 全部17项UI与交互review

- 时间：2026-08-24 14:05 +0800（系统时钟；早于既有15:25记录）
- 状态：`TARGETED_AUTO_PASS`
- 全工具：m2直接打开顶部裁剪、多角度、重绘、暂停打光、更多、颜色、素材库、下载、全屏，以及更多内扩图、擦除、标注、增强、调整像素、抠图、快速切分、Seedance；覆盖互斥Host、inert、Escape/外点、焦点返回、Tab/Shift+Tab、IME、busy/error、reduced-motion、四档zoom screen-space、输出节点和请求守卫
- 费用门：客户端图片工具源码静态扫描没有用户可见`预计/USD/CNY`渲染；m2对更多菜单、详情、扩图、擦除、增强、抠图、裁剪、调整像素、快速切分、标注、Seedance、多角度和重绘逐面板做DOM否定断言。能力DTO和fake任务中的后台`estimatedCost/costCurrency`保留，不展示且不改变账单合同
- 透明持久语义：普通上传与本地派生PNG在上传前本地扫描Alpha，持久保存`imageHasTransparency`；节点把棋盘格限制在按实际比例计算的图片frame，全屏限制在图片元素，普通壳层保持纯灰。透明400×300上传、刷新、节点、全屏和切分链已直接通过
- 来源语义：普通替换上传写`local-upload`并清除旧图片工具mask/outpaint/source标记；裁剪、调整像素、标注、保守增强、快速切分节点持久写operation/operationId/sourceAssetId，详情不再把本地派生节点误写成本地上传
- 首轮命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts --spec tests/m2-image-node.spec.ts`
- 首轮结果：`24/24 PASS`、退出0；source/snapshot`cd314b37…ee03f`一致，4173 listener unchanged
- 测试命令纠错：一次把不存在的`tests/m18-browser-ui.spec.ts`传给safe runner，精确身份门在产品spec前退出1，执行产品测试0；正确文件为`tests/m18-typography.spec.ts`
- 最终命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m2-image-node.spec.ts --spec tests/m18-typography.spec.ts`
- 最终结果：m2 `11/11` + m18 `2/2` = `13/13 PASS`、退出0；source/snapshot`8f2af35a…70de`一致，4173 listener unchanged；未重复已通过且产品树未再变化的m100
- 环境与边界：Node22.23.1/npm10.9.8，fresh临时suite/dynamic loopback；TypeScript/build/架构/source coverage/凭据/网络门通过；真实Generation/Provider/OSS/费用0，没有full
- 验收：`IMGEDIT-034 = TARGETED_AUTO_PASS`；`IMGEDIT-029～037`自动层具直接证据，浏览器矩阵仍待R7
- 阻断：无
- 唯一下一动作：R7在新临时数据与动态loopback完成三视口、四zoom、透明/横竖方图、拥挤画布和17项浏览器矩阵，保存零请求与bounds证据

## 11. R7 定向自动与浏览器矩阵

- 时间：2026-08-24 14:20 +0800（系统时钟）
- 状态：`TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS`
- 环境：本Goal新建`/private/tmp/unboundry-inc005-r7-browser-hF9Jf4`，动态loopback `127.0.0.1:49766`，Vite/data/runtime/cache和全部测试素材只位于该临时根；未使用4173、app/data、生产数据、真实OSS或Provider
- 素材：16:9不透明图、9:16不透明图、1:1不透明图、400×300且Alpha有效内容为200×200的透明PNG；1280×720、1440×900、1728×900均有真实页面操作
- 透明Surface：透明上传节点把棋盘格限制在272.7×204.75的真实图片frame而非卡片；全屏只在400×300图片矩形出现棋盘格，dialog和viewer保持纯灰黑；不透明1:1和9:16没有透明标记。透明快速切分读取`100,50,200,200`有效边界，舞台与透明填充未进入网格
- 视口与工具：1280×720实测全屏1240×680、扩图/擦除1118×686；1440×900实测快速切分920×620、Seedance 400×539.6；1728×900实测多角度600×308。全部bounds在viewport内，Host精确1个，modal root inert，用户可见文本无预计USD/CNY
- 图片与切分：1:1上传持久后frame 204.75×204.75；快速切分2×2透明源使用有效边界，3×3和4×4在不透明900×900源分别显示确认9张/16张，三档共用同一source bounds合同
- 放置与刷新：连续两次本地调整像素生成节点坐标依次为`(832,300)`和`(1222,300)`，源节点为`(442,300)`；三个250×250节点间保持140px空隙且不覆盖，刷新后ID和坐标逐字保持
- 交互与UI：顶部九项及更多八项由m2真实Playwright逐一覆盖；本轮浏览器补验工具栏顺序、打光暂停态、更多菜单八项顺序、三视口代表面板、透明Surface和本地派生输出。四档zoom `0.15/0.85/1.0/1.5`由同一m2对全部screen-space工具做精确几何断言；浏览器插件的滑杆操作未形成可靠档位变更，因此不将其冒充手工四zoom证据
- 控制台与请求：候选浏览器console error0/warn0；只有Vite连接debug和React DevTools info。本地工具自动请求守卫与m2 Generation/Provider数组均为0；生成式入口处于fake/管理员停止态，未提交真实任务。真实Generation/Provider/OSS/费用仍为0
- 定向自动：复用R6同一相关代码树safe m100+m2 `24/24 PASS`以及最终m2+m18 `13/13 PASS`；R7浏览器操作没有修改产品/测试树，不为安心重复已经通过的spec
- 受保护与外部影响：受保护JSON不在本工作树diff/stage；现有54523与4173均未触碰；生产、GitHub、package、schema、Provider协议和用户项目无变化
- 验收：`IMGEDIT-029～037 = TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS`；`IMGEDIT-038`进入R8，用户层仍未通过
- 阻断：无
- 唯一下一动作：冻结当前代码候选，执行diff/架构/受保护文件门和独立只读审查；关闭阻断后在最终不变树上执行本Goal唯一一次safe full

## 12. R8 候选冻结与独立审查

- 时间：2026-08-24 14:58 +0800（系统时钟）
- 状态：`COMPLETE / LOCAL_ENGINEERING_COMPLETE / INDEPENDENT_REVIEW_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`
- 第一轮独立审查：报告5个P1与2个P2，覆盖透明编辑器、详情缺失值、隐藏业务Prompt、扩图预览几何、极小Alpha切分、本地/模型文案和失败图片全屏入口；候选未放行
- 修正：透明棋盘格只加在各编辑器实际图片元素；擦除默认Prompt、创意增强和抠图固定指令全部可见；扩图预览复用真实输出像素几何；极小Alpha按grid fail-closed；本地操作文案和失败图片入口明确
- 第二轮独立审查：新增1个P1（本地替换残留旧生成详情）和1个P2（放置未优先React Flow measured尺寸）；候选继续未放行
- 最终修正：本地替换原子清理旧生成、工具和详情元数据，未知来源显示`—`；放置优先`node.measured`，并直接覆盖父子、批量和实测尺寸碰撞
- 最终定向命令：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m100-modular-ports.spec.ts --spec tests/m2-image-node.spec.ts`
- 最终定向结果：`24/24 PASS`（m100 13、m2 11）、退出0；source/snapshot`015a73299059eb26c2e5cd6e6c2fc43c5e8de1694f23a08618a971fd9a4e95c8`一致，4173 listener unchanged，Provider/OSS/费用0
- 失败纪律：此前两轮测试失败均保留；第一次为两个旧按钮名称超时，第二次为React Flow虚拟化导致视口外节点DOM计数0，均只复验最小m2；已通过m100没有为安心重复，直到最后产品逻辑再次变化才与m2共同复验
- 第三轮独立审查：`INDEPENDENT_REVIEW_PASS`，P0/P1/P2均无剩余；受保护JSON不在diff/stage
- 浏览器：R7三视口矩阵继续保留；最终m2又以真实Playwright覆盖透明编辑器、非方图扩图几何、AI结果本地替换详情、隐藏Prompt否定和失败入口，未发真实请求
- 唯一safe full：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs full`
- 原始结果：120 specs / 1053 tests，`1052/1053 PASS`、退出1；blocked0、skipped0、retries0、reportErrors0，source/snapshot`d8e52414f50b6c24d1018659dfcde8003057a6681f19eab699ffa9b1e3b7970b`，4173 listener unchanged
- 唯一失败：m38的治理断言只允许`CURRENT_V…USER_PASS/USER_RECHECK`并强制本地候选版本等于package，无法表达当前真实的`USER_REJECTED / 未指定候选版本`；其余1052项全部通过，图片工具产品spec无失败
- 精确修正：m38接受带INC阶段的`USER_REJECTED`治理标记、本地未定候选版本，并只要求历史模块化文档保持同一版本前缀；未改变产品代码或发布状态
- 最小复验：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`，修正后`15/15 PASS`、退出0；最终文档同步后同一精确spec再次`15/15 PASS`、退出0，source/snapshot`d7eb22750e71e5940320b6dfa403b35be85f158111578fb7b9fa1988e25a8e26`；4173 listener unchanged
- 测试纪律：未运行第二次full；原始`1052/1053`事实不改写为全绿
- R8结论：`LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS / INDEPENDENT_REVIEW_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`
- 唯一下一动作：进入R9发布门核对；当前因缺新的明确版本号和对应发布句子而阻断

## 13. R9 GitHub与生产发布

- 时间：2026-08-24（v0.6.37发布门恢复）
- 状态：`IN_PROGRESS / VERSION_GATE_VALID / RELEASE_GATE_VALID`
- 原因：生产v0.6.36的版本号与发布授权已执行并消费；`v0.6.37`仅为方案建议。用户最新“开始，一次性搞完”授权本地施工，不等于新的版本号确认和版本对应发布句子
- 证据：package仍为0.6.36；本候选未commit、push、PR、merge、tag、SSH或发布；生产仍是v0.6.36且用户拒收
- 已完成替代工作：R0～R8、全部代码、定向、三视口浏览器、独立审查、唯一一次safe full与文档收口均已完成；Provider/尝试/成功/费用`0 / 0 / 0 / 0`
- 恢复条件：用户明确提供两条当前发布门，例如`版本号确认：v0.6.37`和`允许发布：v0.6.37 上线`
- 唯一下一动作：获得发布门后先只读核对远端tag/release身份，再执行R9；发布后才进入生产零付费复验并等待用户明确`USER_PASS`

### R9恢复：v0.6.37发布门与版本身份

- 用户最新明确指令：`版本号确认：v0.6.37`；`允许发布：v0.6.37 上线`。两项发布门精确有效，本次授权只用于INC-IMGEDIT-005候选
- 实时Git：分支`codex/inc-imgedit-005-user-rejection-2026-08-24`，HEAD与`origin/main`均为`a4bb48c60dc7f62b23f4ca776da47f7931ba6e6f`；候选改动隔离在专用worktree
- 版本身份：本地tag、远端tag和GitHub Release `v0.6.37`均不存在；v0.6.36保持不可变
- 工作树保护：主工作树受保护JSON仍未跟踪；本候选diff/stage均未命中该文件。其他worktree没有同范围活动写入；独立审查已完成
- 版本同步：package/lock/runtime final role/m81与当前治理区开始同步为0.6.37；schema仍为39，生产在切换前仍为v0.6.36
- 外部边界：Provider请求、尝试、成功、费用及真实OSS测试写入仍为`0 / 0 / 0 / 0 / 0`
- 阻断：无
- 首轮版本定向：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts --spec tests/m81-deployment-hardening.spec.ts`；m81 `41/41 PASS`，m38 `14/15 PASS`，总计`55/56`、退出1。唯一失败是CURRENT_STATE本地候选字段在版本号后加了说明，不符合既有精确治理格式；产品代码和版本运行时合同无失败
- 精确修正：只将本地候选字段改为`**v0.6.37**`；不重复已通过的m81
- 最小复验：同一safe入口仅运行m38，`15/15 PASS`、退出0；source/snapshot SHA-256同为`3096a3615431a705d490f29c30da5b45003220ce07877f27ca6056b1f0f354b1`，4173 listener unchanged
- 版本定向结论：m81 `41/41 PASS`与m38最小复验`15/15 PASS`；首转`55/56`的治理格式失败保留，不写成合并`56/56`一次全通过
- 提交前门：origin/main仍为`a4bb48c`，`git diff --check`通过，受保护JSON未进入diff/stage；功能与版本候选已提交为`3bb6fb0`
- 唯一下一动作：提交本次候选身份文档收口，对最终治理树仅复验m38；通过后创建不可变注释v0.6.37 tag并push分支/tag、PR/CI/merge

## 14. Checkpoint更新模板

```text
时间：
阶段：R?
状态：IN_PROGRESS / AUTO_PASS / USER_RECHECK / BLOCKED
branch / HEAD / origin-main：
工作树摘要：
保留/修正/新增/删除文件：
package / schema / candidate：
版本门 / 发布门：
Provider / OSS / 费用：
测试命令、环境、范围、结果和退出码：
浏览器视口、zoom、素材、操作和结果：
参数与输出节点证据：
架构和数据风险：
设计偏差：
阻断：
回滚点：
唯一下一动作：
```
