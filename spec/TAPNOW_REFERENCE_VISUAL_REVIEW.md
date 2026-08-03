# TapNow 40图视觉复核记录

复核日期：2026-07-27  
状态：`REVIEWED`  
图片目录：`reference/tapnow-v2.12.2-dense/`  
机器清单：`tapnow-reference-manifest.json`

## 1. 复核方式

- 先按文件序号生成7张联系表，确认40张图片均可正常解码、内容与manifest状态一致。
- 再以原始尺寸单独复核图片高级编辑、Agent、连接手势和Text创作栏等高信息量状态。
- 静态截图只证明画面中可见状态；行为结论仍需要manifest中的可逆操作记录或后续TapNow活体补测。
- 本轮没有把图标外观猜成业务名称；名称只采用已记录tooltip或历史实时DOM结果。

## 2. 固定区域标注

`1280×720`参考视口：

| Region ID | 区域 | 基线 |
|---|---|---|
| `R-TL` | 左上项目区 | `x16 y16 w320 h40` |
| `R-TR` | 右上动作区 | `x1055.63 y16 w209.37 h40` |
| `R-DOCK` | 左侧Dock | `x15 y183 w54 h338` |
| `R-BL` | 小地图与底栏 | Panel `x15 y511 w257 h194` |
| `R-WORLD` | world节点/edge层 | 除固定screen UI外的画布区域 |
| `R-AGENT` | Agent | `x800 y0 w480 h720` |
| `R-FILES` | Files抽屉 | 右侧/右上，宽`320px` |

图片编辑器精确区域以
`TAPNOW_REFERENCE_EVIDENCE_CATALOG.md`第8节和对应fixture为准。

## 3. 逐图复核

| # | 文件 | 视觉确认 | 关联规格 | 限制 |
|---:|---|---|---|---|
| 01 | `01-neutral-1280x720.png` | 密集画布、Image主节点、edge、Dock、小地图、顶栏 | `legacy.dense-canvas.neutral` | 只证明该viewport和fit状态 |
| 02 | `02-add-menu-1280x720.png` | 指针附近深色创建菜单 | `menu.add-node.double-click` | 独立Image Editor入口仍有冲突 |
| 03 | `03-search-1280x720.png` | 640px级搜索面板、分类、结果行 | `modal.node-search.empty` | 当前1135视口高度不同 |
| 04 | `04-assets-1280x720.png` | 320px素材面板、Tab、搜索、文件夹 | `panel.assets.personal-empty` | 拖入画布逻辑未证明 |
| 05 | `05-workflow-1280x720.png` | 500×500模板面板和首次提示 | `panel.templates.public` | 模板实例化未证明 |
| 06 | `06-history-1280x720.png` | 420×420历史面板、媒体Tab、卡片网格 | `panel.history.final` | 历史恢复逻辑未证明 |
| 07 | `07-text-selected-1280x720.png` | Text选中、卡片、外部创作栏 | `node.text.selected-editing` | 工具栏部分在画面上沿裁切 |
| 08 | `08-text-normal-1280x720.png` | Text中性态，无外部创作栏 | `node.text.empty` | 不证明hover |
| 09 | `09-text-editing-1280x720.png` | Text编辑卡片和选中边界 | `node.text.selected-editing` | 输入行为需活体验收 |
| 10 | `10-playlist-focused-audio-video-nearby-1280x720.png` | 横向Playlist、片段、邻近Audio/Video | `node.playlist.empty` | 时间尺和已有片段状态不同于新建空态 |
| 11 | `11-audio-selected-1280x720.png` | Audio波形、播放按钮、左右端口、外部创作栏 | `node.audio.success` | 不证明seek结果 |
| 12 | `12-video-selected-1280x720.png` | Video九宫格结果、自绘进度、外部创作栏 | `node.video.success` | 工具栏完整名称未确认 |
| 13 | `13-storyboard-table-region-1280x720.png` | 卡片式Storyboard、媒体、文字、视图工具 | `legacy.node.storyboard-table` | 编辑/排序/完成loading未证明 |
| 14 | `14-comment-dock-mode-1280x720.png` | Comment Dock激活态 | `mode.comment.armed` | 0724画布没有Comment节点 |
| 15 | `15-ai-image-creator-result-1280x720.png` | Image结果与外部Prompt/参数创作栏 | `node.image.prompt-ready` | 成功提交逻辑由其他证据补充 |
| 16 | `16-image-selected-tools-1280x720.png` | Image选中与上方工具层 | `legacy.node.image-result-toolbar` | 画面只显示部分world上下文 |
| 17 | `17-image-context-menu-1280x720.png` | 240px级Image专属右键菜单 | `menu.canvas-context.node` | 专属项目完整禁用条件未证明 |
| 18 | `18-multiselect-ports-connections-1280x720.png` | 多节点、端口、edge和Group同屏 | `interaction.selection-and-keyboard-move` | 不证明多选动作顺序 |
| 19 | `19-image-deep-tools-toolbar-1280x720.png` | 400×48九项工具栏、40×40按钮 | `legacy.node.image-result-toolbar` | 名称依赖tooltip记录 |
| 20 | `20-image-editor-node-1280x720.png` | Image和独立图片编辑器节点同屏 | 仅视觉参考；`CF-ADD-01` | 不证明当前创建菜单仍保留该入口 |
| 21 | `21-image-editor-open-1280x720.png` | 全屏图片编辑器、画布、垂直工具、底部Prompt | 仅视觉参考；`OPEN-016` | 具体编辑器工作流未冻结 |
| 22 | `22-image-crop-1280x720.png` | 裁剪遮罩、选区、底部控制 | `legacy.editor.image-crop` | 取消/确认写入逻辑未证明 |
| 23 | `23-image-multi-angle-1280x720.png` | 多角度面板、预览立方体、三滑杆、广角 | `legacy.editor.image-multi-angle` | 参数提交和结果逻辑未证明 |
| 24 | `24-image-redraw-1280x720.png` | 画笔/框选/橡皮工具、Prompt卡 | `legacy.editor.image-redraw` | 蒙版坐标和生成逻辑未证明 |
| 25 | `25-image-lighting-1280x720.png` | 灯光预览、亮度、色温、方向、轮廓光 | `legacy.editor.image-lighting` | 生成和失败逻辑未证明 |
| 26 | `26-image-more-menu-1280x720.png` | Image更多菜单和多项高级工具 | `legacy.menu.image-more` | 各项真实能力和结果未证明 |
| 27 | `27-copilot-1280x720.png` | 480px Agent、问候、两建议卡、composer | `panel.agent.expanded-empty` | 消息/工具协议未证明 |
| 28 | `28-files-1280x720.png` | 320px Files与480px Agent并列 | `panel.agent.files-empty` | 文件产生/下载未证明 |
| 29 | `29-viewport-1440x900.png` | 1440×900扩展视口、固定UI锚点稳定 | `legacy.responsive.1440x900` | 仅一张复杂状态截图 |
| 30 | `30-viewport-1920x1080.png` | 1920×1080扩展视口、更多world内容可见 | `legacy.responsive.1920x1080` | 仅一张复杂状态截图 |
| 31 | `31-node-hover-1728x882.png` | Video hover、控件显隐和大空白world区域 | 仅视觉参考；`NODE-012` | hover时序未证明 |
| 32 | `32-node-selected-1728x882.png` | Video selected、外部创作栏和工具条 | `node.video.success` | 部分工具名未知 |
| 33 | `33-node-dragging-1728x882.png` | Video dragging截图，节点位置变化 | `interaction.pointer-drag-at-1.3` | 静态图不证明跟手性 |
| 34 | `34-group-resizing-1728x882.png` | Group四边与角resize控制 | `legacy.node.group-dense-selected` | resize极值未证明 |
| 35 | `35-edge-connecting-1728x882.png` | 连接手势期间节点工具层和端口上下文 | `legacy.interaction.source-aware-connect-menu` | 临时edge在缩略图中不够显著，行为依赖操作记录 |
| 36 | `36-edge-invalid-same-side-1728x882.png` | 同侧非法尝试后的无新增edge状态 | `legacy.interaction.invalid-same-side-edge` | 单张图不能独立证明前后edge计数 |
| 37 | `37-selected-edge-endpoint-drag-1728x882.png` | 已选edge及明显的端点拖线预览 | 仅视觉参考；`OPEN-003` | 不证明存在专用edge updater |
| 38 | `38-text-selected-ai-creator-v2122-1728x826.png` | Text selected、617×48工具条、外部creator | `node.text.selected-editing`、`CF-TEXT-01` | 旧14项与当前项目差异待补测 |
| 39 | `39-text-editing-ai-creator-v2122-1728x826.png` | Text editing与creator同时可见 | `node.text.selected-editing`、`CF-TEXT-01` | 编辑/creator互斥规则需活体复核 |
| 40 | `40-final-clean-v2122-1728x826.png` | 临时操作清理后的复杂画布终态 | `legacy.dense-canvas.final-v2122` | 只证明该历史项目终态 |

## 4. 视觉复核新增结论

1. 40张文件均为TapNow画面，没有发现Lumino截图混入。
2. 图片19、22–26足以冻结高级编辑的视觉壳，不足以证明提交和失败逻辑。
3. 图片27–28证明Agent 480px与Files 320px并列关系，不证明Agent业务协议。
4. 图片35–37必须结合manifest的动作记录；不能只凭静态图推断edge重连能力。
5. 图片38–39显示旧复杂画布中Text工具条和creator的组合状态，与当前新建Text报告存在差异，继续保留`CF-TEXT-01`。
6. 图片20证明历史画布存在Image Editor节点，但不能证明当前创建菜单仍应展示该入口。

## 5. 仍需活体TapNow补测

- 本文逐图“限制”列中的所有行为。
- `OPEN-001`至`OPEN-024`。
- 任何涉及付费、权限、麦克风、第二账号或外部分享的状态。

