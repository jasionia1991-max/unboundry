# TapNow 绿地复刻验收矩阵

基线日期：2026-07-27  
当前状态更新：2026-08-03  
状态：`AUTHORITATIVE`  
状态夹具：`tapnow-state-fixtures.json`

当前176条记录中：129条`PASS`、12条`NOT_STARTED`、4条`BLOCK`、8条`PARTIAL`、3条`PAUSED`、6条`N/A/NOT_APPLICABLE`，其余14条为已裁决的`RESOLVED*`状态。当前没有等待人工确认的`USER_RECHECK`；第二批10次人工验收已于2026-08-02统一同步，下一批从0/10重新计数。节点入参两轮TapNow证据已完成，但`INPUT-001～007`实现和人工验收尚未完成，不得提前标PASS。2026-08-03按用户明确要求提前登记`RELAY-001～012`，不计入常规10次人工验收同步。

## 1. 判定规则

| 状态 | 含义 |
|---|---|
| `NOT_STARTED` | 复刻实现尚未验收 |
| `PASS` | TapNow 证据、自动检查、真实浏览器人工验收全部通过 |
| `USER_RECHECK` | 候选实现和自动检查已完成，仍必须等待用户实页确认 |
| `PARTIAL` | 当前范围已有真实证据，但同一条目的剩余必要条件尚未完成 |
| `BLOCK` | 用户验收失败、证据不足或必要外部能力不可用 |
| `PAUSED` | 用户明确决定暂缓，保留现有实现但不继续验收 |
| `OPEN` | TapNow 行为尚未勘测，禁止猜测 |
| `N/A` / `NOT_APPLICABLE` | 私有版范围明确不实现 |
| `RESOLVED*` | 开放问题已按当前证据、状态或层级完成裁决，不再重复验收 |

全局阈值：

- 稳定元素包围盒误差：`≤1 CSS px`。
- 关键区域像素差异：`≤5%`，且不得以整体平均掩盖明显局部错误。
- 交互必须同时验证视觉、事件命中、状态转换和持久化。
- 自动化 PASS 不能覆盖用户真实浏览器的 FAIL。
- 2026-07-30 用户决定该项目仅供小范围自用，不实现额度、积分、订阅或费用计算；TapNow 原始证据中的数值只作为历史参考，不再是本项目验收要求。

## 2. G0 工程边界

| ID | 优先级 | 项目 | 参考 | 验收方法 | 当前状态 |
|---|---|---|---|---|---|
| G0-01 | P0 | 旧 Lumino 复用计划废止 | 旧计划顶部 | 出现 `SUPERSEDED / 禁止执行` 和新计划路径 | PASS |
| G0-02 | P0 | 完全绿地正式计划 | 新计划 §0 | 明确禁止代码、数据、端口和部署复用 | PASS |
| G0-03 | P0 | 独立 Git 仓库 | `app/.git` | `git -C app rev-parse --show-toplevel` 只返回 `app` | PASS |
| G0-04 | P0 | 复刻约束文件 | `REPLICA_CONSTRAINTS.md` | 绿地、事实源、1px、隐私和品牌约束齐全 | PASS |
| G0-05 | P0 | 状态夹具可解析 | JSON fixture | 标准 JSON 解析成功、fixture ID 唯一 | PASS |
| G0-06 | P0 | 禁止 Lumino 污染 | 整个 `app` | 除证据 `upstream` 外，不存在 Lumino 实现路径、源码、资源、数据库和配置 | PASS |
| G0-07 | P0 | 历史 TapNow 证据已分类 | `TAPNOW_REFERENCE_EVIDENCE_CATALOG.md` | TapNow 事实、条件状态、历史计划和排除内容边界明确 | PASS |
| G0-08 | P0 | 详细绿地实施方法 | `TAPNOW_DETAILED_IMPLEMENTATION_METHOD.md` | 每阶段有实现顺序、方式、检查和门禁 | PASS |
| G0-09 | P0 | 旧证据来源可追溯 | `evidenceSources` | 当前报告、Stage0、40图、像素基线具有稳定 source ID | PASS |
| G0-10 | P0 | 40图机器清单已提取 | `tapnow-reference-manifest.json` | 40个文件名、视口、DPR、状态和SHA完整且唯一 | PASS |
| G0-11 | P0 | 40张真实 TapNow PNG 已自包含 | `reference/tapnow-v2.12.2-dense/` | 本地恰好40张，文件名和SHA与机器清单逐一一致 | PASS |
| G0-12 | P0 | 40图视觉复核与标注完成 | `TAPNOW_REFERENCE_VISUAL_REVIEW.md`、`tapnow-reference-annotations.json` | 每张图均有结论并关联 fixture，或明确标为仅视觉参考 | PASS |

## 3. 空画布与固定 UI

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| UI-001 | P0 | `shell.empty.primary` | 打开 `1135×917@2x` 空项目；根容器、黑色背景、隐藏滚动正确 | M0冻结全页截图、DOM bounds及用户空壳实页验收 | PASS |
| UI-002 | P0 | `shell.empty.primary` | 点阵基础间距 20、偏移 -11、基础半径 0.5；放大时间距与点半径同步增大且更清晰，缩小时同步减小且更弱 | SVG pattern属性、缩放自动检查及用户实页复验 | PASS |
| UI-003 | P0 | `shell.empty.primary` | 左上项目区及标题坐标误差 ≤1px | TapNow 活体 DOM、本地自动坐标、用户实页复查 | PASS |
| UI-004 | P0 | `shell.empty.primary` | 顶部社区/分享坐标误差 ≤1px；不显示积分入口 | 本地自动坐标、用户实页复查 | PASS |
| UI-005 | P0 | `shell.empty.primary` | 左侧七个入口、外框、间距、圆角、模糊一致 | TapNow 活体 DOM、坐标 JSON、截图 diff、用户实页复查 | PASS |
| UI-006 | P0 | `shell.empty.primary` | 中央五个快捷入口仅在无节点时出现 | 空态/有节点截图、自动检查、用户实页复查 | PASS |
| UI-007 | P0 | `shell.empty.primary` | 底栏、小地图、吸附、fit view、zoom、帮助坐标一致 | TapNow 活体 DOM、本地坐标和截图、25项自动检查、用户实页复查 | PASS |
| UI-008 | P1 | `shell.empty.primary` | Agent 气泡位置、尺寸、收起动画和命中区一致 | TapNow 活体 DOM、本地坐标和截图、用户实页复查 | PASS |
| UI-009 | P1 | `panel.minimap.empty` | 空小地图约 198×148，无节点 rect | 本地自动检查、SVG 快照、用户实页复查 | PASS |
| UI-010 | P0 | `shell.empty.primary` | 页面无原生滚动，画布 pane 光标和 role 正确 | DOM/样式快照及用户实页复验 | PASS |
| UI-011 | P0 | `legacy.dense-canvas.neutral` | `1280×720@2x` 下62节点/58边/5组复杂画布与固定 UI 同屏正确 | 参考01、DOM/graph及用户实页复验 | PASS |
| UI-012 | P1 | `legacy.responsive.1440x900` | `1440×900@1x` 锚点、面板、world/screen 分层一致 | 参考29、bounds及用户实页复验 | PASS |
| UI-013 | P1 | `legacy.responsive.1920x1080` | `1920×1080@1x` 锚点、面板、world/screen 分层一致 | 参考30、bounds及用户实页复验 | PASS |

## 4. 菜单、面板和覆盖层

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| SURF-001 | P0 | `menu.add-node.double-click` | 双击空白和添加按钮打开同类菜单；位置、七项、禁用态一致 | 冻结菜单事实、双入口DOM、bounds、无文字误选自动检查及用户实页复验 | PASS |
| SURF-002 | P1 | `modal.node-search.empty` | 搜索 modal 尺寸、分类、placeholder、空态一致 | TapNow活体、冻结截图、640×440 bounds、a11y及用户实页复验 | PASS |
| SURF-003 | P1 | `modal.node-search.empty`、`interaction.node-search.populated` | 有节点时按标题、Prompt、正文搜索并定位 | 真实节点索引、分类/结果断言、拖远后定位自动检查及用户实页复验 | PASS |
| SURF-004 | P1 | `panel.assets.personal-empty` | 个人/团队、文件夹、搜索和空态布局一致 | TapNow活体、冻结截图、面板/搜索bounds、交互断言及用户实页复验 | PASS |
| SURF-005 | P2 | `overlay.ai-characters.loaded` | 全屏覆盖层、分类、筛选、5列/60卡和加载更多 | TapNow v2.12.8活体、响应式列数、筛选/加载断言、零Provider请求及用户实页复验 | PASS |
| SURF-006 | P1 | `panel.templates.public` | 悬浮面板、首次提示、浏览全部、Tab 和三列卡片一致 | TapNow v2.12.8活体、冻结坐标、三状态交互、零Provider请求及用户实页复验 | PASS |
| SURF-007 | P1 | `mode.comment.armed`、`interaction.group-comment-resize-sandbox-current` | 评论按钮激活、自定义光标、下一点击出现输入框；0/200、空提交禁用、提交创建48×48 Comment、可退出 | 历史证据保留；2026-07-28用户取消私有版评论功能 | NOT_APPLICABLE |
| SURF-008 | P1 | `panel.history.final` | 媒体 Tab、计数、浏览全部和缩放/排序一致；图片、视频、音频真实素材可预览、下载并重新添加到画布 | TapNow v2.12.8活体、冻结坐标、缩放/排序交互、历史素材操作专项及用户实页复验 | PASS |
| SURF-009 | P1 | `menu.user.free-plan` | FREE、额度和限制功能由用户取消；历史证据保留但不实现 | 2026-07-30用户范围决定 | N/A |
| SURF-010 | P1 | `menu.project` | 私有版项目菜单只保留重命名、新建项目和删除；工作空间尚未实现，TapTV和竞技场已由用户明确取消，不显示不可用占位入口；重命名继续刷新持久化 | 用户产品裁决、DOM bounds、外点/Escape关闭、项目标题直接刷新持久化及自动检查；2026-07-31用户已确认精简菜单及账号浮层关闭修复通过 | PASS |
| SURF-011 | P2 | `overlay.settings.subscription` | 订阅功能由用户取消；历史证据保留但不实现 | 2026-07-30用户范围决定 | N/A |
| SURF-012 | P2 | `modal.community` | 社区功能及右上角入口由用户取消；历史证据保留但不实现 | 2026-07-31用户范围决定 | N/A |
| SURF-013 | P1 | `popover.share` | 仅保留“移动到团队项目”入口；团队功能开发前保持禁用 | TapNow v2.12.8活体、用户范围裁决、关闭交互及用户实页复验 | PASS |
| SURF-014 | P1 | `modal.keyboard-shortcuts` | 640×566 两列弹窗、五个分组及全部快捷键文案一致 | TapNow v2.12.8活体、DOM bounds、入口/关闭交互及用户实页复验 | PASS |
| SURF-015 | P0 | `menu.canvas-context.blank` | 空白右键菜单位置、项目、分隔线和 disabled 状态一致 | TapNow v2.12.8活体、DOM bounds、安全动作及用户实页复验 | PASS |
| SURF-016 | P0 | `menu.canvas-context.node`、`interaction.edge-clipboard-sandbox-current` | 节点菜单复制/粘贴/副本/删除/报告及禁用逻辑一致；同画布复制后粘贴创建偏移副本且不依赖浏览器虚拟剪贴板 | TapNow v2.12.8活体、DOM bounds、graph diff、系统剪贴板不变及用户实页复验 | PASS |
| SURF-017 | P1 | `shell.empty.primary` | 任一 modal/panel 打开后 Escape、外点、focus return 行为正确 | 键盘、外点、焦点DOM及用户实页复验 | PASS |

## 5. 画布基础交互

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| CANVAS-001 | P0 | `interaction.selection-and-keyboard-move` | 单击选择，Shift+点击多选，选中 z-index=1000；选中外观为 `#7a7a7a` 2px圆角描边，不出现蓝边或可见方形缩放角点；未选中且未悬浮时两侧连接点不可见，鼠标悬浮即显示，选中后移开鼠标仍常态显示 | 用户实页复查、DOM class、computed style、opacity | PASS |
| CANVAS-002 | P0 | `interaction.selection-and-keyboard-move` | 方向键移动 5px，Shift+方向键移动 20px | 自动前后坐标 JSON | PASS |
| CANVAS-003 | P0 | `interaction.pointer-drag-at-1.3` | zoom=1.3 真鼠标拖拽；屏幕位移/1.3=逻辑位移 | 自动指针操作、坐标 | PASS |
| CANVAS-004 | P0 | `interaction.resize-bottom-right` | 八向缩放操作区域存在但视觉透明；右下 resize 可独立改宽高且位置不变 | 自动指针操作、computed style、前后尺寸 | PASS |
| CANVAS-005 | P0 | `interaction.snap-to-grid` | 激活吸附后坐标落 20px 网格，点阵仍显示；放大时点阵更清晰、缩小时更弱 | 用户实页复查、DOM 属性、前后坐标 | PASS |
| CANVAS-006 | P0 | `interaction.manual-connect-image-to-video` | 从起点节点的连接点拖出，松到目标节点身体任意位置即可连接，不要求对准目标连接点；可与 Text 输入并存 | 用户实页复查、edge JSON | PASS |
| CANVAS-007 | P0 | `workflow.text-to-video.created` | 空态点击“文字生视频”后快捷入口隐藏，生成250×250 Text、444×250 Video及Text→Video三次贝塞尔连线；Text预填英文电影镜头Prompt；连线无箭头并有2秒循环白色高光 | 截图、自动graph/尺寸/computed style、用户实页复查 | PASS |
| CANVAS-008 | P0 | `interaction.delete-cascade-and-undo`、`interaction.group-comment-resize-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | 节点可用 Backspace 无确认删除并级联；连线被点击或鼠标停留约 0.7 秒后，中央出现 32×32剪刀按钮；仅悬浮触发时移出连线/剪刀区域即消失，点击触发时保持；点击剪刀只删连线且保留两端节点 | 连线部分和节点级联均获用户实页确认、自动graph diff | PASS |
| CANVAS-009 | P0 | `interaction.delete-cascade-and-undo` | Cmd+Z 恢复副本，新 node ID、同 asset 引用 | 自动graph/asset JSON、用户实页复查 | PASS |
| CANVAS-010 | P1 | `interaction.selection-and-keyboard-move` | 框选、反选、点击空白清选和工具栏显隐正确；多选整体框为半透明灰底、灰色1px实线、16px圆角且无蓝色阴影 | 用户实页复查、自动指针操作、computed style、选择快照 | PASS |
| CANVAS-011 | P0 | — | zoom 范围 0.15–2；左键拖空白框选，普通触控板双指横向/纵向滑动按1.2系数平移且zoom不变，捏合缩放；缩放中心和平移手感一致 | 用户实页复查、TapNow活体对照、自动指针操作、viewport JSON | PASS |
| CANVAS-012 | P1 | `interaction.fit-five-nodes` | 5 节点 fit view 得到全节点可见和近似参考矩阵 | 自动前后可见性、viewport | PASS |
| CANVAS-013 | P1 | `interaction.selection-and-keyboard-move` | 有节点小地图 rect、selected、mask 和导航一致；198×148内容区外侧1px边线连续无断口；200×150拖动层按2倍系数反向平移且zoom不变，单击/滚轮无动作 | 用户实页复查、TapNow活体对照、自动 SVG DOM、拖动与滚轮 viewport | PASS |
| CANVAS-014 | P0 | `interaction.source-aware-connect-menus-current` | Image/Video/Audio 连线松到空白打开各自的5项/4项/2项来源菜单；外框宽288、内边距4、标题区40、内容宽278、行高52、间距4、图标框36；拖动来源节点时临时线保持连接；点击空白或其他节点后临时线、菜单和临时节点均清理，原3节点/0正式连线不变 | 活体DOM、自动菜单尺寸、拖动跟随、点击其他节点关闭、graph、用户实页复查 | PASS |
| CANVAS-015 | P0 | `legacy.interaction.invalid-same-side-edge`、`interaction.edge-clipboard-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | self、source→source、重复和二节点环不生成第二条稳定 edge；临时预览可关闭；失败端点拖拽保持原edge；当前普通edge无显式updater；无冲突的B→C仍可新增 | 参考36、自动指针、graph diff、用户实页复查 | PASS |
| CANVAS-016 | P1 | `legacy.dense-canvas.neutral` | 62节点/58边/5组拖拽、zoom、面板交互无持续掉帧或全量保存；小地图触摸板横滑不得触发浏览器返回 | DOM/graph、长任务监测、请求统计、横滑回归检查、用户实页复查 | PASS |
| CANVAS-017 | P0 | `interaction.multi-source-connect-to-node` | 多选时隐藏各节点左右加号，只在整体选择框右侧中线外12px显示一个20×20共用加号；拖动时每个已选节点各出现一条预览线，松到额外目标节点身体任意位置后，每个已选节点各生成一条到目标的稳定连线；多选保持；框选已连线节点不得显示连线剪刀，只有直接点击连线或悬浮约0.7秒才显示 | 用户截图、TapNow活体DOM/指针、本地自动graph diff、两轮用户实页复查 | PASS |

## 6. 节点视觉与编辑

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| NODE-001 | P0 | `node.text.empty`、`interaction.resize-large-text-playlist-sandbox-current` | Text 默认250×250、标题、左右端口、阅读态一致；宽高可独立扩大，至少到2671×3530不clamp | TapNow 活体 DOM、本地 bounds、自动检查、用户实页复查 | PASS |
| NODE-002 | P0 | `node.text.selected-editing` | 双击正文进入编辑；按双击坐标放置光标；第一次 Escape 退出编辑但保留选中，点击空白清选；普通状态可拖动而编辑状态正文不带动节点 | TapNow 活体键盘/DOM、本地自动检查、用户实页复查 | PASS |
| NODE-003 | P0 | `node.text.selected-editing` | 标题编辑、中文 IME、保存中/已保存反馈正确 | 中英文及混合输入、Cmd+Z、保存状态专项自动检查、用户实页复验 | PASS |
| NODE-004 | P1 | `node.text.selected-editing` | 48px 格式栏及 H1/H2/H3/正文/粗斜体/列表/分隔线可用 | TapNow 活体 DOM、本地编辑结果、自动检查、用户实页复查 | PASS |
| NODE-005 | P0 | `node.image.empty`、`interaction.upload-media-sandbox-current` | Image 空态250×250；横图以高250、竖图以宽250保持原始比例，16:9为444×250、9:16为250×444；上传态隐藏左侧加号、保留右侧加号；两态均无resize control；上传态可拖动、悬浮显示替换、标题支持中英文编辑；上传/替换/改名/移动可Cmd+Z | 横竖图上传、替换、端口、拖动、比例、撤回及中文标题均获用户实页确认 | PASS |
| NODE-006 | P0 | `node.image.prompt-ready` | 678×80 Prompt、Nano Banana 2 Lite、`自适应 · 1K`、`1×`、成本5及空Prompt时Generate禁用逻辑一致；取消选中自动收起且空Image主体可拖动 | 冻结状态、表单与交互自动检查、用户实页复查 | PASS |
| NODE-007 | P0 | `node.video.empty`、`node.video.success`、`interaction.upload-media-sandbox-current` | Video空态444×250；上传后保持原始比例，横向高250、竖向宽250且576×1024为250×444；隐藏左侧加号、保留右侧加号；无resize control；节点内无中央大播放图标，选中/悬浮显示静音、播放、0.1秒进度、时长和放大；详情含播放器、音量、252×180提示词、八项信息、应用到画布及下载；支持上传、替换、拖动、标题和Cmd+Z | 2026-07-28真实TapNow活体DOM/坐标/播放状态、自动检查、用户实页复查 | PASS |
| NODE-008 | P0 | `node.audio.empty`、`node.audio.success`、`interaction.upload-media-sandbox-current` | Audio空态/上传态均444×250且无resize control；上传后隐藏左侧加号；波形由真实音频采样生成，播放位置逐帧更新；替换仅悬浮显示，下载位于选中态上方48px工具栏；支持±10秒、播放/暂停、拖动、中英文标题及Cmd+Z | 2026-07-28真实TapNow活体DOM/尺寸/工具栏、真实WAV解码与播放自动检查、用户实页复查 | PASS |
| NODE-009 | P0 | `node.playlist.empty`、`node.playlist.workflow`、`interaction.resize-large-text-playlist-sandbox-current` | Playlist 默认960×104、时间尺、空态一致；所有状态隐藏左右连接加号；仅有片段且选中时左侧显示两个50×50切割/导出按钮，左偏58px、间隔8px；宽高可独立扩大，至少到2057×3785不clamp；片段选择、删除、裁剪、排序、双播放头、缩放预览与导出行为一致 | TapNow活体DOM、用户截图、本地bounds、真实媒体自动检查、用户实页复查 | PASS |
| NODE-010 | P0 | `node.group.selected`、`interaction.group-comment-resize-sandbox-current`、`interaction.group-text-playlist-large-sandbox-current` | 外接矩形建组、默认标题、圆角、8个resize control；Image+Video样本缩至312×147；Text+Playlist按四周20px包围盒建组并可扩至5047×4024且不缩放子节点；整体移动、解组和删除/撤回保持正确父子关系 | TapNow活体DOM、graph diff、本地自动检查、用户实页复查 | PASS |
| NODE-011 | P0 | 全部节点 | 当前范围内七类节点为独立产品实现，无巨型 GenericNode 条件树；Comment已由用户移出范围 | 七类组件注册与实现边界代码审查 | PASS |
| NODE-012 | P1 | 全部节点 | 标题、端口、工具栏、resize chrome 的 hover/focus/selected 状态一致；Image工具栏400×48/9按钮、Video工具栏442×48/10按钮已通过用户复查，高级按钮功能不在视觉候选中伪报完成 | 2026-07-28活体DOM尺寸、状态截图集、自动bounds、各节点用户实页复查 | PASS |
| NODE-013 | P1 | `legacy.node-geometry.families` | 节点首次按内部素材比例自动适配；自动尺寸、比例派生和之后的用户八向resize互不混淆，手动尺寸刷新后保留 | 尺寸族fixture、节点几何与刷新专项自动检查、2026-08-01用户实页复验 | PASS |
| NODE-014 | P1 | `legacy.node.storyboard-table`、`interaction.storyboard-entry-template-sandbox-current` | 能载入并渲染历史1200×1000、两完成一卡加载、字段和双视图；当前菜单和“分镜大师”均无独立节点，不得臆造创建入口 | 参考13、数据快照、当前菜单DOM、本地专项检查及用户实页复查 | PASS |
| NODE-015 | P1 | `legacy.node.comment`、`interaction.group-comment-resize-sandbox-current` | 48×48锚点、300×73气泡、200字限制、空提交禁用且当前态无resize control | 历史证据保留；2026-07-28用户取消私有版评论功能 | NOT_APPLICABLE |
| NODE-016 | P0 | `legacy.node.group-dense-selected` | 3443×2111 Group、390×48工具条、24×24角控件及布局/颜色动作一致；整组执行和创建模板留待对应业务阶段 | 参考34、TapNow当前活体DOM、本地bounds、graph diff与用户实页复验 | PASS |

## 7. 上传、媒体与生成

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| MEDIA-001 | P0 | `interaction.upload-image` | 系统文件选择器上传 PNG，传输态后自动生成 Image 节点 | 自有媒体文件落盘、节点/刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-002 | P0 | `interaction.upload-image` | 标题去扩展名、尺寸 250×250、有替换、不会进生成历史 | 标题、尺寸、替换、独立媒体身份、历史0新增、刷新及用户实页复验通过 | PASS |
| MEDIA-003 | P0 | — | 非法 MIME、超限、解码失败安全拒绝且无残留 | MIME、20MB、PNG结构/CRC、像素/解压上限及失败后文件404自动检查通过 | PASS |
| MEDIA-004 | P0 | `node.audio.success`、`interaction.upload-media-sandbox-current` | 上传WAV/MP3/M4A/AAC后显示正确时长；播放/暂停、前后10秒、进度、刷新恢复正确 | 自有服务器落盘、分段播放、真实波形、控制、WAV/MP3/M4A刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-005 | P0 | `node.video.success`、`interaction.upload-media-sandbox-current`、`interaction.edge-delete-reconnect-download-sandbox-current` | 上传MP4后320×180/1s、muted、自绘播放到ended；下载按钮tooltip、enabled态和最终文件正确，刷新恢复 | 自有服务器落盘、分段播放、元数据、进度、逐字节下载、标题即时刷新自动检查及用户实页复验通过 | PASS |
| MEDIA-006 | P0 | `interaction.upload-media-sandbox-current` | 本地PNG/MP4/WAV经真实文件选择器上传成功；完成态无临时节点、敏感数据或残留传输 | PNG、MP4、WAV/MP3/M4A分别通过真实素材用户复验及node/media/残留自动断言 | PASS |
| GEN-001 | P0 | `node.image.generating` | 图片生成中控件禁用、18×18 点阵、blur/scale/easing 一致 | 冻结状态、样式、零Provider请求及用户实页复验 | PASS |
| GEN-002 | P0 | `node.image.success` | 图片成功保持 250×250、contain、收藏、Prompt/参数保留 | 冻结状态、零Provider请求及用户实页复验 | PASS |
| GEN-003 | P0 | `node.video.generating` | 视频生成中所有指定控件禁用，并按用户决定使用点阵呼吸动效 | 用户实页复验、DOM及零Provider请求 | PASS |
| GEN-004 | P0 | `node.video.success` | 成功视频、历史+1，不显示或计算额度；Seedance 2.0 Mini真实16:9/480p/5秒视频进入私有OSS并可播放、下载、历史预览和重启恢复 | 冻结成功态、独立历史记录；真实任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`、方舟任务`cgt-20260801165221-6fsd7`、结果SHA-256及2026-08-01用户实页复验 | PASS |
| GEN-005 | P0 | `node.audio.success` | 一次展示2个结果、历史+2，不显示或计算额度 | 本地双结果、独立历史记录、零Provider请求及用户实页复验 | PASS |
| GEN-006 | P0 | — | queued/running/success/failed/cancelled/retrying/recovering全状态均使用真实任务验证；取消不发布结果，超时保留原任务，同一任务重试只增加attempt，服务重启不自动重提；退款因额度/积分已取消而不适用 | 真实取消任务`6a9fbe16-d234-4a0e-badf-d19f2b54ffae`、超时后重试成功任务`327c2051-c2d4-4c96-9c41-f30525cd9556`、重启恢复失败任务`6a1ecfa4-a9f8-4c04-adc1-d6548982cbf8`、状态事件审计及2026-08-01用户实页确认 | PASS |
| GEN-007 | P0 | — | 幂等提交和服务重启不重复任务、不重复历史；内部持久任务表、请求指纹、状态事件审计、真实Provider提交、结果素材发布和画布引用已接通；真实图片与真实视频结果均通过停止、重启、刷新、历史和下载复验 | 图片任务`438b50dd-cd9c-42ed-8321-1fcbd49adf35`和视频任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`均保持唯一任务/历史/媒体和画布引用；视频重启后数据库仍为7条任务且只有1条视频任务，2026-08-01用户实页确认 | PASS |
| GEN-008 | P0 | `node.text.creator-open` | 选中文字节点后显示参考素材、提示词、模型、数量和提交区；失焦关闭；真实能力接入前所有动作按钮保持禁用且不得调用付费 Provider | 参考38–39、控件状态、网络检查及用户实页复验 | PASS |
| GEN-009 | P0 | `node.image.reference-ready` | 图片节点通过连线成为目标图片生成节点的参考素材；目标输入区显示参考图缩略片，删除缩略片同时删除对应连线，撤销同时恢复连线与缩略片；提交只保存归属当前账号且状态ready的素材ID，执行时才生成短时私有OSS地址或校验后的本机PNG数据，不持久化短时地址；模型不支持或超过上限时必须拒绝且不得调用Provider | 2026-07-31 TapNow单张图片活体补测、OpenRouter官方`input_references`规则、构建、图片节点9项及Provider/任务/上传/模型13项零付费自动检查；2026-08-01用户实页确认通过 | PASS |

### 7.1 节点入参与引用优化

| ID | 优先级 | 项目 | 验收动作与断言 | 当前证据/缺口 | 实现状态 |
|---|---|---|---|---|---|
| INPUT-001 | P0 | 类型化连线矩阵 | 本项目允许11种组合：Text目标接收四类，Image接收Text/Image，Video接收四类，Audio只接收Text；其余5种不落edge并打开来源感知菜单 | TapNow两轮实测为9允许/7拒绝；用户明确扩展Text目标。当前Canvas仍只拒绝自连、重复和反向环 | PARTIAL |
| INPUT-002 | P0 | 统一输入解析与UI状态 | 从edge解析来源及`empty/uploading/ready/invalid/missing`；统一引用卡、角色、顺序、阻塞原因、删除/撤销和刷新恢复 | Text已有局部上游卡；四节点尚无共享解析器和完整状态组件 | PARTIAL |
| INPUT-003 | P0 | Image的Text+Image闭环 | 上游Text作为提示词母版，上游Image作为参考图；自身Prompt为空可用母版，两者都有时显示最终合并Prompt；服务端保存不可变输入快照 | Image参考图真实链路已PASS，但当前Image组件不读取上游Text，提交Prompt仍只取自身输入 | PARTIAL |
| INPUT-004 | P0 | Text四类上游 | Text、Image、Video、Audio均可作为理解输入；自身指令默认必填，模型可配置上游Text替代；不支持媒体时保留edge并显示模型不兼容 | 当前Text UI可显示四类上游并读取第2版规则，但Generate固定禁用且无Text任务/Provider映射 | PARTIAL |
| INPUT-005 | P0 | Video全能参考 | Text、Image、Video、Audio卡片及首帧/尾帧/主体/普通参考角色；Seedance当前规则最多9图/3视频/3音频；提交前完成参数、费用和Provider能力预检 | TapNowready素材与模式已实测；当前Video组件和服务端仍拒绝真实非Text参考提交 | PARTIAL |
| INPUT-006 | P1 | Audio文字合并 | 只接受Text上游；区分上游母版、自身Prompt和歌词，展示最终合并结果；重试不得重复任务 | TapNow上游Text可启用提交已实测；当前Audio组件未读取edge，Mureka真实生成另由`AUDIO-REAL-001`暂缓 | PARTIAL |
| INPUT-007 | P0 | 新模型、预检和持久化 | 管理员配置输入类型、数量、角色、组合、必填条件和Provider适配；不兼容切换不静默删引用；刷新/重启/复制/删除/重试不重复 | 第2版参数和参考数量已PASS；角色、组合、统一Provider输入快照及完整回归尚未实现 | PARTIAL |

## 8. 持久化、历史和权限

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| DATA-001 | P0 | `persistence.nodes-assets-viewport` | 节点、edge、媒体引用、音频时长、viewport 刷新后恢复 | SQLite文档、刷新与接口自动检查、用户实页复验 | PASS |
| DATA-002 | P0 | `persistence.final-clean-canvas` | 清空后刷新仍 0 节点/0边、占位恢复 | SQLite文档、无首屏闪回刷新检查、用户实页复验 | PASS |
| DATA-003 | P0 | `panel.history.final` | 删除画布节点不删除账号级历史 | 独立SQLite历史表、删除/刷新自动检查、用户实页复验 | PASS |
| DATA-004 | P0 | — | 服务重启后项目、任务和媒体可恢复 | 画布、视野、媒体引用、历史及运行中任务通过真实进程重启；真实图片与Seedance视频结果均保持唯一任务/历史/媒体和私有OSS引用，刷新、预览、播放及下载由用户于2026-08-01实页确认 | PASS |
| DATA-005 | P0 | `persistence.revision-conflict` | 两标签 revision 冲突不静默覆盖 | 真实双页409、服务端内容保持、重新载入恢复自动检查、用户实页复验 | PASS |
| AUTH-001 | P0 | — | 未登录无法访问项目、媒体或任务；普通用户只能访问自己的数据，管理员管理普通账号和后台配置；公开注册关闭 | 专项1项及全量95项自动检查通过；用户已亲自完成首管理员初始化、普通账号创建与登录，确认普通用户无管理入口、管理员直达地址被拦截、历史为0且停用后无法再次登录；21画布、10历史、3标题和273媒体已归首管理员 | PASS |
| AUTH-002 | P0 | — | owner 可邀请/撤销，member 不可管理成员；团队项目和成员系统均按用户决定后期再做 | 用户决定后期再做 | PAUSED |
| AUTH-003 | P0 | `tests/m9-provider-secret-safety.spec.ts` | Provider 密钥不进入浏览器源码/产物、请求头、外部网络、仓库敏感文件或错误响应；当前零Provider接入 | 源码与生产包扫描、浏览器网络、4类错误响应及敏感文件检查 | PASS |
| OPS-001 | P0 | — | 当前未部署服务只监听`127.0.0.1:4173`，本机可访问而局域网地址不可访问；不得把本地验证表述为公网部署 | 进程参数、监听socket、本机与局域网地址对照探测及2026-08-01用户确认 | PASS |
| OPS-002 | P0 | — | SQLite+媒体备份可恢复到新目录并正常登录播放 | 阶段B前后备份均含SQLite、273个媒体文件及逐文件SHA-256清单，并已恢复到临时新目录真实启动；登录、管理员接管旧数据和跨账号隔离已自动及人工通过；正式服务器定时备份与整机恢复演练仍未开始 | PARTIAL |
| STORAGE-001 | P0 | — | 管理员专属存储状态、普通用户隐藏；本机素材保持可读并记录对象键、类型和SHA-256；未配置OSS时云请求必须关闭且密钥不进入浏览器或数据库 | 存储/权限/上传专项16项、全量99项自动检查、273个本机素材校验值、schema 7可恢复备份及用户实页复验 | PASS |
| STORAGE-002 | P0 | `/admin/storage` | 阿里云私有Bucket、最小权限RAM身份、随机对象键、私有上传、V4短时读取签名、失败清理及云端Range/下载完整；路由默认关闭且只作用于新素材，旧本机素材不自动迁移 | 新RAM身份真实连接、短时读取和清理成功；新图片私有上传后数据库记录为OSS/ready且本机273个旧文件未变化，真实根画布刷新后仍保留图片节点，真实Range与完整下载SHA-256一致；构建、全量103项及生产隔离通过；2026-07-31用户在内置浏览器确认新图片显示、刷新保留和下载通过 | PASS |
| STORAGE-003 | P0 | `/admin/storage` | 管理员可在网页新增/替换OSS配置；AK/SK密码输入且不回显，服务端专用文件加密保存，普通账号、浏览器、SQLite、接口及审计均不得获得完整密钥；保存不访问云端，测试连接和选为正式配置必须分开授权 | 项目构建、相关专项7项、全量100项、重启恢复及正式构建隔离检查通过；管理员页面独立滚动及画布隔离28项检查通过；用户实页确认配置保存和页面滚动正常 | PASS |
| SAFETY-001 | P0 | `/admin/generation-safety` | 管理员独占真实生成总开关、紧急停止、用户/类型并发、每分钟频率、连续失败冷却、每日/月度后台费用停止线和运行中任务策略；未知成本及0费用上限必须在调用Provider前拒绝，普通用户不显示额度或费用UI | schema 8持久设置、管理员权限与审计、规则直接检查及管理页专项3项；生成任务/权限/密钥合计7项、全量106项、重启恢复和正式构建隔离通过；Provider未连接且付费请求为0；2026-07-31用户实页确认通过 | PASS |

## 9. 播放列表、Agent 与外围面板

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| PLAY-001 | P0 | `node.playlist.empty`、`node.playlist.workflow`、`node.playlist.pick-ready` | 点击加号进入选片，来源节点不可拖，顶部提示、连续添加、反馈和 ESC/退出一致 | 真实TapNow活体DOM、本地真实媒体自动检查及用户实页复验 | PASS |
| PLAY-002 | P0 | `node.playlist.workflow`、`node.playlist.clips-ready` | 9:16与16:9真实视频添加后节点仍可移动；片段拖动即时让位、总时长和自适应预览正确；片段结束后连续播放下一片 | 两个真实带声MP4自动检查、时间轴DOM及用户实页复验 | PASS |
| PLAY-003 | P0 | `node.playlist.workflow`、`node.playlist.clips-ready` | 鼠标逐帧预览、点击提交播放头、空格播放；节点内缩放时间轴、节点外缩放画布；双侧裁剪柄及 `C/Q/E`、Cmd+Z正确 | 真实TapNow内置浏览器实测、片段起止数据、逐帧缩略图、自动检查及用户实页复验 | PASS |
| PLAY-004 | P0 | `node.playlist.workflow` | 三项导出菜单一致且均有可见结果；FFmpeg按顺序和裁剪点输出真实MP4，导出到画布在当前视野生成Video；请求中断终止进程并清理临时文件 | 三类下载/节点自动检查、真实MP4+ffprobe、服务端中断清理代码及用户实页复验 | PASS |
| AGENT-001 | P1 | `panel.agent.expanded-empty` | 展开后画布裁切到655px、Agent 480px；建议卡与输入区坐标一致 | 截图、DOM bounds及用户实页复验 | PASS |
| AGENT-002 | P1 | `menu.agent.add-and-model` | 添加菜单、引用选择、确认模式、动态模型菜单一致 | TapNow v2.12.4实页复核、本地状态截图、菜单交互、零Provider自动检查及用户实页复验 | PASS |
| AGENT-003 | P1 | `panel.agent.files-empty` | 文件面板 320×200、标题和空态一致 | 参考28、DOM bounds、展开/收起自动检查及用户实页复验 | PASS |
| AGENT-004 | P1 | — | Agent 操作先预览，确认后原子写入画布；真实消息/工具协议尚无证据且未接入真实Agent，禁止伪造执行结果 | `OPEN-021`、命令/graph diff | BLOCK |
| AGENT-005 | P0 | — | 拒绝、重复确认、越权文件和项目访问被安全处理；依赖真实Agent命令和权限协议 | `OPEN-021`、安全测试 | BLOCK |

## 10. 自有数据契约

| ID | 优先级 | 参考 | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| API-001 | P0 | `observedContracts.canvas` | 自有 API 支持画布节点、edge、viewport、revision、项目标题和安全模型参数配置，不照抄TapNow私有协议；说明页仅管理员可见且不会暴露密钥 | OpenAPI 3.1`/api/openapi.json`、管理员只读页`/admin/api-contract`、保存后读取端到端检查、131项全量回归及2026-08-01用户确认 | PASS |
| API-002 | P1 | `observedContracts.templates` | 模板分类、分页、搜索和 graph 数据可支撑已验收 UI | 自有`/api/templates`、26节点/31连线模板graph、界面联测及2026-08-02批量同步确认 | PASS |
| API-003 | P1 | `observedContracts.agent` | 模型、技能、建议由服务端动态配置 | 自有`/api/agent-config`、默认文字模型隔离、暂停技能/建议界面联测及2026-08-02批量同步确认 | PASS |
| MODEL-001 | P0 | — | 管理员管理节点模型目录、发布/停用/设默认；真实目录默认为空，普通用户只看到管理员已发布的显示名称，不接触Provider或内部配置 | 管理权限与节点联动专项2项、全量97项自动检查、无占位模型迁移、阶段C可恢复备份及用户实页复验 | PASS |
| MODEL-002 | P0 | Text/Image/Video/Audio真实节点 | 所有生成节点使用共享、可扩展的模型参数结构；管理员可为当前及以后新增模型设置允许值、默认值和参考素材上限，普通用户只看到当前模型允许参数；不支持项禁用且前后端均不得发送 | 参数注册表、四类节点持久化、任务模型快照、灰色自绘菜单专项检查及2026-08-01用户实页确认 | PASS |
| PROVIDER-001 | P0 | `/admin/providers` | 管理员按“平台连接→模型→节点发布”管理生成平台；第一版支持OpenRouter、火山方舟和OpenAI兼容中转站，密钥在服务端加密保存且不回显，普通用户不可访问；保存与修改均不连接外部平台、不启用真实生成 | 管理权限、加密文件、SQLite/审计无密钥、修改保留原密钥、界面零外部请求专项2项；全量108项通过、1项受控真实OSS检查跳过；2026-07-31用户实页确认通过 | PASS |
| PROVIDER-002 | P0 | `/admin/providers` | OpenRouter和OpenAI兼容连接只用GET读取模型列表验证；不得调用生成接口；错误只返回安全中文分类；火山方舟不虚构只读模型列表，添加首个模型时再验证 | 只读方法、地址、鉴权、模型计数、管理员权限、火山方舟不支持边界及零生成请求自动检查；项目构建、专项9项、全量109项通过和1项受控真实OSS检查跳过；2026-07-31用户实页确认只读连接及节点模型设置通过 | PASS |
| API-004 | P1 | `observedContracts.characters` | 角色分类、筛选、分页和总数由服务端提供 | 自有`/api/characters`、60→80加载、筛选/分页界面联测及2026-08-02用户确认 | PASS |
| API-005 | P1 | `observedContracts.library` | 个人/团队空间、文件夹、分页素材契约完整 | 自有`/api/library`、个人/团队隔离、3个本地素材、分页/总数界面联测及2026-08-02用户确认 | PASS |
| API-006 | P0 | `observedContracts.account` | 当前用户、workspace和权限来自私有服务，不依赖 TapNow；不提供额度接口 | 自有`/api/account-context`、权限/离线检查、零额度接口及2026-08-01用户确认 | PASS |

### 10.1 多协议中转站接入

计划依据：`TAPNOW_RELAY_PROVIDER_INTEGRATION_PLAN.md`。本节是本项目Provider扩展，不是TapNow实页复刻证据。实现完成只能进入`USER_RECHECK`，未经用户实页确认不得标PASS。

| ID | 优先级 | 项目 | 验收动作与断言 | 实现状态 |
|---|---|---|---|---|
| RELAY-001 | P0 | 多协议平台连接与密钥安全 | 第三方身份、基址、协议和Key状态清晰；密钥不进入浏览器、日志、业务数据库、产物或错误响应 | NOT_STARTED |
| RELAY-002 | P0 | Key与目录只读检查 | 检查只调用目录GET；不得调用聊天、图片、视频或音频生成接口 | NOT_STARTED |
| RELAY-003 | P0 | 目录兼容与回退 | 增强目录和`/v1/models`均可解析；分页、异常、去重和重复同步安全 | NOT_STARTED |
| RELAY-004 | P1 | 模型发现UI | 搜索、节点类型/协议筛选、紧凑复选框、长文本截断和固定批量操作栏无覆盖 | NOT_STARTED |
| RELAY-005 | P0 | 导入模型中心草稿 | 已选模型生成候选草稿；不自动发布、不改变默认模型、不重复创建 | NOT_STARTED |
| RELAY-006 | P0 | OpenAI文字协议 | Chat Completions与Responses使用统一任务快照、结果和错误分类 | NOT_STARTED |
| RELAY-007 | P0 | Claude文字协议 | Messages协议映射准确，不根据模型名称猜协议 | NOT_STARTED |
| RELAY-008 | P0 | Gemini文字协议 | GenerateContent协议映射准确，Key和原始响应不泄露 | NOT_STARTED |
| RELAY-009 | P0 | 图片协议 | GPT Image和通用图片任务复用统一入参、安全素材与私有结果发布 | NOT_STARTED |
| RELAY-010 | P0 | 视频异步任务 | 通用媒体提交、轮询、重启恢复、结果校验和发布完整 | NOT_STARTED |
| RELAY-011 | P0 | 音频异步任务 | 通用媒体提交、轮询、格式/时长校验和发布完整；不恢复Mureka收费重试 | NOT_STARTED |
| RELAY-012 | P0 | 停用、安全删除与全局回归 | 默认、节点、任务引用受保护；现有OpenRouter、火山方舟、Mureka和已验收画布不降级 | NOT_STARTED |

## 11. 图片高级编辑

| ID | 优先级 | Fixture | 验收动作与断言 | 证据 | 实现状态 |
|---|---|---|---|---|---|
| IMGEDIT-001 | P0 | `legacy.node.image-result-toolbar` | 400×48工具条、九个40×40按钮、顺序和 tooltip 一致 | 参考19、bounds、自动检查及用户实页复验 | PASS |
| IMGEDIT-002 | P1 | `legacy.menu.image-more` | 更多菜单尺寸、圆角、padding、项目和切分子项一致 | 参考26、截图 diff、自动检查及用户实页复验 | PASS |
| IMGEDIT-003 | P0 | `legacy.editor.image-crop` | 全屏裁剪、编辑器/选区/底栏/比例菜单坐标一致 | 参考22、bounds、自动检查及用户实页复验 | PASS |
| IMGEDIT-004 | P0 | `legacy.editor.image-crop` | 取消零写入；确认保留原节点并新建裁剪结果节点，由原图自动连线到结果 | TapNow用户实测、node/edge/asset检查及修正后用户实页复验 | PASS |
| IMGEDIT-005 | P1 | `legacy.editor.image-multi-angle` | 600设计宽、旋转/倾斜/缩放/方向/广角/重置状态一致 | 参考23、参数快照、自动检查及用户实页复验 | PASS |
| IMGEDIT-006 | P1 | `legacy.editor.image-redraw` | 画笔/框选/橡皮、蒙版坐标、Prompt卡与缩放映射一致 | 参考24、蒙版像素检查、自动检查及用户实页复验 | PASS |
| IMGEDIT-007 | P1 | `legacy.editor.image-lighting` | 亮度、色温、方向、轮廓光和预览几何一致 | 参考25；用户决定暂停，入口禁用且实现保留 | PAUSED |
| IMGEDIT-008 | P0 | 全部高级编辑 | 取消/失败不发布半成品；原图不可被静默覆盖 | 裁剪取消、保存失败故障注入、原/派生asset检查及用户实页复验 | PASS |
| IMGEDIT-009 | P0 | 全部高级编辑 | 无真实后端能力的按钮保持禁用，不伪造成功 | 高级编辑能力矩阵、真实disabled状态、零Provider请求及用户实页复验 | PASS |

## 12. 未知项与范围裁决

| ID | 优先级 | 未知行为 | 开始实现前动作 | 状态 |
|---|---|---|---|---|
| OPEN-001 | P1 | 拖动顶层节点到视口左/右/上/下边缘时画布沿对应方向自动移动且zoom不变；普通状态允许节点重叠，只有开启左下角网格吸附后才吸附到20px网格并阻止顶层节点重叠 | TapNow `1280×720@2x`真实指针/DOM、用户截图纠正、本地四方向viewport、吸附开/关双状态自动检查及修正后用户实页复验 | PASS |
| OPEN-002 | P0 | resize 最小/最大、媒体比例约束 | 当前可达的Text、Playlist、两种Group组合及媒体比例均已实测并由用户验收；大型样本未观察到clamp，因此不臆造全局最大值；Storyboard/Table当前无创建入口，其完整生命周期独立保留在OPEN-019 | RESOLVED-CURRENT |
| OPEN-003 | P0 | 自连/重复/成环/角色非法、重连、独立删线 | 非法连线与独立删线均已验收；TapNow当前普通edge无显式端点updater，本地普通edge也明确不可重连，不凭空新增成功重连；仅在后续发现其他可重连特殊edge时重新打开 | RESOLVED-CURRENT |
| OPEN-004 | P1 | 系统剪贴板跨画布复制粘贴 | TapNow实测“复制”只在当前画布标签内生效：原画布4→5，另一个画布5→5；系统剪贴板不是节点跨画布通道。本地继续保留已通过的同画布内部复制，不发明跨画布节点格式 | RESOLVED-CURRENT |
| OPEN-005 | P0 | 视频/音频本地上传 | 合成MP4/WAV真实文件选择器上传并播放成功 | RESOLVED |
| OPEN-006 | P0 | 视频/音频下载文件结果 | 本地MP4和MP3下载均产生真实完整文件，文件名、字节及SHA-256与可播放源文件完全一致；Audio工具栏统一为项目规范后获用户实页确认 | PASS |
| OPEN-007 | P0 | 取消、失败、超时、重试、退款 | 真实任务已覆盖取消、TIMEOUT、同任务重试成功、服务重启`running→recovering→failed`及不自动重提；失败卡保留安全错误和单行重试入口；退款随用户取消全项目额度功能而不适用 | PASS |
| OPEN-008 | P0 | 多标签写冲突 | 已由`DATA-005`完成同账号双标签补测：旧revision写入返回409、服务端不被静默覆盖、重新载入恢复最新内容，并获用户实页确认 | RESOLVED-CURRENT |
| OPEN-009 | P2 | 多人实时协作 | 当前为个人小范围自用，团队项目也已由用户决定以后再做；多人实时协作随团队能力暂停，未来需要两个真实账号和同一项目权限后重新打开 | PAUSED |
| OPEN-010 | P2 | 分享、克隆、发布、团队移动 | 私有版公开发布/团队移动 | N/A |
| OPEN-011 | P1 | 创建菜单是否独立包含“图片编辑器” | 当前菜单无该项；保留历史 Image Editor 状态证据 | RESOLVED-CURRENT |
| OPEN-012 | P1 | Search 高度 440/520 的响应式规则 | 内容驱动，高度上限 `min(520px,100vh-72px)` | RESOLVED |
| OPEN-013 | P1 | Text 工具条 14项与当前较少项的关系 | selected/editing 均为 `617×48` 完整14项 | RESOLVED |
| OPEN-014 | P0 | Playlist 时间尺结束 `00:50/01:00` | 新建空态 `01:00`；历史已有内容状态 `00:50` | RESOLVED-STATE |
| OPEN-015 | P1 | Group 圆角 `12/16px` | 外层 React Flow 节点 `16px`，内层可见框 `12px` | RESOLVED-LAYER |
| OPEN-016 | P0 | 图片高级编辑提交、取消、失败和结果版本 | `IMGEDIT-001～006、008、009`均已逐项获用户确认；打光按用户决定保留实现但禁用入口并暂停，由`IMGEDIT-007`单独管理 | RESOLVED-CURRENT |
| OPEN-017 | P1 | Video结果工具栏完整十项 | 当前TapNow十项顺序、`442×48`几何和tooltip已记录；本地Video工具栏此前已由用户确认，未接入高级能力继续保持禁用 | RESOLVED-CURRENT |
| OPEN-018 | P0 | Image/Video/Audio来源感知菜单完整项目 | Image 5项、Video 4项、Audio 2项；取消均无残留 | RESOLVED |
| OPEN-019 | P1 | Storyboard/Table完整编辑生命周期 | 当前菜单无入口，“分镜大师”也只是通用节点组合；没有真实可达路径前继续只保留已通过的历史节点载入渲染，不臆造创建/编辑/resize行为 | BLOCK |
| OPEN-020 | P1 | Group整组执行、模板更新、下载全部 | 当前无真实生成和模板后端，整组执行、更新模板保持禁用；下载全部会下载组内6个真实可用素材，专项自动检查及用户实页复验通过 | PASS |
| OPEN-021 | P1 | Agent消息、工具、确认、拒绝、失败和恢复协议 | 当前没有获准接入真实Agent、工具调用和权限协议；输入/执行保持禁用，不伪造确认、拒绝、失败或恢复结果，等真实Agent后端获准后重新打开 | BLOCK |
| OPEN-022 | P1 | `panel.agent.voice` | 用户点击后才请求麦克风；允许后本机录音可停止、预览、清除和取消，拒绝有明确提示；录音只在当前页面暂存且零Provider请求，转写因无获准服务保持未接入 | 自动允许/拒绝双路径、Agent回归及用户实页复验 | PASS |
| OPEN-023 | P1 | `panel.assets.drag-ready` | 图片、视频、音频本地素材可从素材库拖入画布，落点建节点、源素材保留、真实音频显示64段波形、刷新恢复且零Provider请求；模板搜索/预览和复杂实例证据已完成，创建/更新/失败回滚继续因无模板后端保持禁用 | 三类真实本地素材拖放、音频真实波形、graph/刷新检查及用户实页复验 | PASS |
| OPEN-024 | P1 | `1512×982@2x`、`1280×720@2x` | `1512×982@2x`固定锚点和页面无溢出；依据28张TapNow冻结参考图，将`1280px`定为当前最小可靠支持宽度并验证同样无溢出 | DPR2截图、1px锚点自动检查及用户可见双尺寸复验 | PASS |
| OPEN-025 | P0 | 清空刷新与多标签旧状态回流 | 原TapNow项目的未知节点来源无法追溯，但本地复刻已由`DATA-002`保证0/0刷新不复活、`DATA-005`保证旧revision返回409且不能覆盖；两项均获用户实页确认，当前回归5项通过 | RESOLVED-CURRENT |

## 13. 阶段放行

| Gate | 必须通过 |
|---|---|
| M0 | UI-001～UI-013、SURF-001 的静态部分 |
| M1 | CANVAS-001～CANVAS-017 |
| M2 | NODE-001～NODE-016 |
| M3 | DATA-001～DATA-005 |
| M4 | MEDIA-001～MEDIA-005、IMGEDIT-001～IMGEDIT-009 |
| M5 | GEN-001～GEN-009、DATA-003～DATA-004 |
| M5.1 | INPUT-001～INPUT-007；先完成P0+P1，再逐项进入用户真实浏览器验收 |
| M5.2 | RELAY-001～RELAY-012；先完成零费用fixture和全局回归，再进入用户真实浏览器验收 |
| M6 | PLAY-001～PLAY-004，且 OPEN-002/003/005/006/014 已裁决 |
| M7 | SURF-002～SURF-017 |
| M8 | AGENT-001～AGENT-005 |
| M9 | AUTH-001～AUTH-003 |
| M10 | 全部 P0/P1 非 `OPEN` 项 PASS，OPS-001/002 PASS，用户真实浏览器验收 PASS |
