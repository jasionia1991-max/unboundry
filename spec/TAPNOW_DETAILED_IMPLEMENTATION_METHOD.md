# TapNow 完全绿地复刻详细实施步骤与方式

状态：`AUTHORITATIVE EXECUTION SPEC`  
当前进度更新：2026-08-01（见§20）  
目标：从空仓库实现 TapNow 画布，不复用 Lumino Web。  
上位计划：`../../TAPNOW_GREENFIELD_REPLICA_IMPLEMENTATION_PLAN_2026-07-27.md`  
证据目录：`TAPNOW_REFERENCE_EVIDENCE_CATALOG.md`

## 1. 固定实施方法

每一个 UI 或功能都使用同一条流水线：

```text
TapNow 原始证据
  → 标注 viewport / DPR / zoom / source / evidence level
  → 冻结状态 fixture
  → 写坐标与状态断言
  → 实现最小独立组件
  → screenshot diff
  → 真实鼠标/键盘/IME/文件选择器
  → 刷新与服务重启
  → 用户并排验收
  → PASS 后进入下一状态
```

禁止先写一整套功能再统一调样式。每个状态按“证据—夹具—实现—验收”闭环。

## 2. 开发目录

代码开始后使用最小单仓结构：

```text
app/
  client/
    src/
      canvas/
        CanvasShell.tsx
        CanvasSurface.tsx
        nodes/
        overlays/
        stateFixtures.ts
      api/
      auth/
  server/
    src/
      http/
      db/
      jobs/
      media/
      providers/
  spec/
  tests/
```

约束：

- 不创建第二个前端状态框架；XYFlow 管画布交互，本地 React state 管临时 UI，服务端数据管持久事实。
- 不创建微服务、Redis、消息总线、插件框架或 CRDT。
- 当前范围内七类节点独立实现；只共享标题、端口、resize chrome、任务遮罩等无业务判断原语。

## 3. Step 0：证据冻结与冲突清理

### 操作

1. 为每个参考状态分配稳定 ID。
2. 记录 `sourceId/evidenceLevel/viewport/DPR/zoom`。
3. 将 40 张 TapNow PNG 的文件名和 SHA 加入新仓库 reference manifest。
4. 复制证据时只复制 TapNow PNG，不复制 Lumino 页面或测试结果。
5. 对 `CF-ADD-01`、`CF-SEARCH-01`、`CF-TEXT-01`、`CF-PLAY-01`、`CF-GROUP-01` 建立补测任务。
6. 未解决冲突保留双 fixture，不选择“看起来更合理”的值。

### 退出条件

- 所有参考图可由 SHA 校验。
- 所有 fixture 都能追溯到报告章节或截图编号。
- 不存在来源不明的坐标和按钮名称。
- `app` 中不存在 Lumino 代码、资源或运行配置。

## 4. Step 1：测试壳与静态状态装载器

### 实现方式

1. 初始化 React/TypeScript/Vite。
2. 建立仅开发环境可用的 fixture URL：
   `/__fixture/:fixtureId`。
3. fixture 装载器只注入确定性数据，不调用 Provider。
4. 建立浏览器坐标采集：
   - `getBoundingClientRect`
   - computed style 白名单
   - viewport、DPR、zoom
5. 建立 screenshot 输出：
   - 参考图
   - 当前图
   - diff 图
   - mismatch 比例
6. 建立敏感信息清洗，证据中不记录用户 ID、邮箱、签名 URL 或密钥。

### 验收

- 同一 fixture 连续渲染截图哈希稳定。
- 坐标 JSON 顺序稳定。
- 动画可在截图模式冻结到指定时间点。
- fixture 路由在生产构建中不可访问。

## 5. Step 2：空画布 Shell

### 实现顺序

1. 全视口黑底和 `overflow:hidden`。
2. 20 world-px 点阵。
3. 左上项目区。
4. 右上三动作区域。
5. 左侧 54×338 Dock。
6. 左下 205×40 控制条和帮助。
7. 右下 44×44 Agent 气泡。
8. 空画布中央快捷入口。
9. z-index 层：world、world overlay、screen chrome、popover、modal。

### CSS 方法

- 使用 CSS custom properties 固化颜色、半径、间距、blur、shadow。
- 固定 UI 用视口锚点和 flex/grid，不写单视口绝对坐标。
- 基线坐标只作为验收值；布局规则必须同时解释 1135、1280、1440、1920。

### 验收顺序

1. `1135×917@2x` 当前空画布。
2. `1280×720@2x` 历史复杂画布壳。
3. `1440×900@1x`。
4. `1920×1080@1x`。
5. Agent 展开后的 655/625/800 等剩余画布宽度。

## 6. Step 3：XYFlow 世界坐标内核

### 实现顺序

1. viewport `x/y/zoom` 与 screen/world 换算。
2. pan、wheel/pinch zoom、zoom slider、fit view。
3. 单选、Shift 多选、四向框选。
4. 主选择和 z-index。
5. 真指针拖拽。
6. 八向 resize。
7. 20px snap-to-grid。
8. 小地图。
9. edge 渲染、透明命中线和选择。
10. 连接预览、合法/非法目标和连接取消。

### 关键检查

- zoom=1.3 时 `screenDelta / 1.3 = worldDelta`。
- screen 工具栏不随 zoom 缩放。
- Pointer cancel、Escape、组件卸载后没有 pointer capture 或临时 edge。
- 62节点/58边/5组下拖动不触发全量持久化。

## 7. Step 4：统一内容模型，但独立节点组件

用户看到的节点类型：

- Text
- Image
- Video
- Audio
- Playlist
- Group
- Storyboard/Table

共同字段只包括：

- id、type、title
- x、y、width、height、z
- selected/locked 状态
- 输入/输出端口
- 类型自己的 data

禁止把所有节点 data 塞进一个无限扩张 JSON 后由巨型 `switch` 渲染。

## 8. Step 5：Text

### 状态顺序

1. `empty`
2. `neutral`
3. `hover`
4. `selected`
5. `title-editing`
6. `body-editing`
7. `creator-open`
8. `saving`
9. `saved`
10. `error`

### 实现方式

- 默认 `250×250 world px`。
- Tiptap 保存受控 JSON，不保存任意 HTML。
- 双击标题只编辑标题；双击正文只编辑正文；两者不得冒泡到画布创建菜单。
- IME composition 期间不自动保存、不触发快捷键。
- Escape 按顶层状态退出。
- 工具条先实现当前确认项；旧14项与新可见项差异作为双 fixture，补测后裁决。

### 验收

- `617×48 screen px` 工具条。
- 中英文长文换行、滚动和 resize。
- `Cmd+Z` 在编辑器内优先撤销文本，在退出编辑后才撤销画布命令。
- `node.text.creator-open` 独立验收参考素材、提示词、模型、数量、额度、提交启用/禁用和失焦关闭；未得到付费生成授权前只实现交互和状态，不调用 Provider。

## 9. Step 6：Image 与图片高级编辑

### 基础节点

1. 空态。
2. 系统文件上传。
3. 图片 contain 预览。
4. Prompt/模型/比例/风格/摄影机/数量创作栏。
5. generating 点阵遮罩。
6. success、favorite、历史、再次生成。
7. duplicate 复用同一 asset。

### 九项工具

按固定顺序实现裁剪、多角度、重绘、打光、浏览全部、Pin、保存到素材库、下载、全屏。

### 高级编辑的实施次序

1. 裁剪：先做纯本地、取消零写入、确认产生派生资产。
2. 重绘蒙版：先做画笔/框选/橡皮和蒙版坐标，不接生成。
3. 多角度：先冻结 UI/参数范围，再接真实 Provider 能力。
4. 打光：先冻结 UI/参数，再接真实 Provider 能力。
5. 更多菜单：只有真实实现的项可启用。

### 数据安全

- 原图不可覆盖；编辑产生派生 asset/version。
- 大图和蒙版使用文件，不把 Base64 放入数据库和日志。
- 取消、失败和服务中断不发布半成品。

## 10. Step 7：Video、Audio、Playlist

### Video

- `444×250` 空态、上传、Prompt、生成参数、loading、成功。
- 自绘播放/暂停、静音、进度、全屏、下载。
- 上游 Text/Image 与局部 Prompt 的合并规则单独补测。

### Audio

- `444×250` 空态、Prompt、歌词、模型、类型、时长。
- 播放/暂停、±10秒、进度和下载。
- 一次任务多结果的成本和历史必须按真实结果数结算。

### Playlist

- `960×104`。
- 首次创建先显示使用说明；确认“继续”后才落节点。
- 先实现选片模式和 Escape 零写入。
- 新建空态时间尺到 `01:00`；历史已有片段样本到 `00:50`，按状态分别实现。
- 宽下限 `250px`、高下限样本 `104px`；已扩大到 `2057×3785` 未见 clamp，但不声明全局最大值。
- 再实现片段顺序、裁剪、C/Q/E、播放头和 FFmpeg 导出。

## 11. Step 8：Storyboard/Table、Group

### Storyboard/Table

- 先用 `1200×1000` 只读 fixture 复刻卡片密度。
- 当前双击创建菜单无 Storyboard/Table，“分镜大师”模板也只实例化 Group/Text/Image/Video；先支持历史节点反序列化和渲染，不添加无证据创建按钮。
- 再实现结构化字段编辑。
- loading 卡必须作为独立状态，不用假数据计时器模拟完成。
- Default/创意视图共享同一数据。
- 创建、卡片增删改、resize 和刷新生命周期在当前可达入口补测前保持 `OPEN`。

### Comment（已取消）

- 2026-07-28用户明确取消私有版评论功能；历史尺寸和交互证据保留，但不进入实现。

### Group

- 外接矩形创建、移动、resize、解组。
- 当前新建组工具条 `341×48`；历史模板组工具条 `390×48`，按状态实现。
- 颜色、宫格、水平、整组执行、模板、下载全部。
- React Flow 外层节点圆角 `16px`，内层可见容器圆角 `12px`。
- Text+Playlist 当前样本按子节点轴向包围盒四周加 `20px` 建组；Group 向外 resize 不缩放子节点。
- Image+Video 组合下限样本 `312×147`；Text+Playlist 已扩大到 `5047×4024` 未见 clamp，均不外推为全局常量。

## 12. Step 9：创建、搜索、连接和上下文菜单

### 创建

- 双击空白创建菜单已确认；Dock Add 本轮没有打开菜单，补测前不得假定两个入口行为等价。
- 当前菜单只有 Text、Image、Video、Audio、disabled 3D World、Playlist 和 Upload，不添加 Storyboard/Table 或独立 Image Editor 项。
- 空白右键按当前 TapNow 显示上传、素材、节点、辅助工具、撤销、重做、粘贴。
- “图片编辑器”入口冲突解决前不写入正式创建菜单。

### 搜索

- 标题、Prompt、正文、类型和 Group。
- 选择结果后居中、调整 zoom、选择目标。
- Search 高度采用响应式约束，补测 440/520 差异。

### 连接

- source 右侧开始，target 左侧结束。
- 松到空白显示来源感知任务菜单。
- Image、Video、Audio 来源显示不同动作。
- 自连、重复、同侧、成环和角色不兼容前后端双重拒绝。
- 重接失败保持原 edge；删除 edge 可撤销。

## 13. Step 10：面板与 Agent

按证据完整度顺序：

1. 节点搜索。
2. 素材库。
3. 工作流/模板。
4. 历史。
5. 用户/项目/帮助。
6. 设置和私有分享替代。
7. Agent 480px。
8. Files 320px。

面板统一检查：

- 锚点、宽高、radius、blur、滚动。
- 打开、Escape、外点、关闭按钮和 focus return。
- 面板遮挡优先级高于 world toolbar。
- 所有视口 `scrollWidth <= clientWidth`。

Agent 先实现 chat shell、附件、模型、确认模式和结构化命令预览；确认前不得修改画布或运行生成。

## 14. Step 11：自有服务端

### 顺序

1. 用户、session、project、member。
2. viewport、node、edge CRUD 和 revision。
3. asset 上传、Range、下载。
4. history、template、comment。
5. SQLite job queue。
6. SSE。
7. Provider adapters。
8. FFmpeg 导出。

### 事务边界

- 节点和 incident edges 同事务删除。
- graph 保存携带 project revision。
- asset 先原子落盘，再发布数据库引用。
- job 成功先确认 asset，再写 history/node。
- 删除 node 不删除账号级 history。

## 15. Step 12：任务与 Provider

1. 先用 fixture 完成所有 UI 状态。
2. 再接一个真实 Image Provider 端到端。
3. 通过失败、超时、取消、重试、重启恢复。
4. 再接 Video。
5. 再接 Audio。
6. 每个 Provider 单独声明模型、参数、成本和结果数量。

不做通用插件系统。Provider 适配器只负责请求、状态查询、取消和结果解析。

## 16. Step 13：自动化与人工验收

### 每个 fixture 的最小自动检查

- DOM 可访问性名称。
- bounding boxes。
- computed style 白名单。
- screenshot diff。
- 状态转换。
- graph/data diff。

### 必须人工

- 真鼠标拖拽、resize、连接。
- 触控板 pan/pinch。
- 双击事件隔离。
- 中文 IME。
- 系统剪贴板和文件选择器。
- 音视频播放、seek、下载。
- 长时间生成、取消和异步额度。

### 性能基线

- 62节点/58边/5组：日常基线。
- 200节点：压力检查，不据此提前引入虚拟化。
- 拖拽期间不写数据库；pointer up 后合并为一次命令。

## 17. Step 14：私有部署

1. Ubuntu 主机建立独立用户和目录。
2. Node 服务监听 `127.0.0.1`。
3. Tailscale/私有组网提供 HTTPS。
4. systemd 管理服务。
5. Provider secret 写服务器权限受限环境文件。
6. SQLite WAL、媒体和配置每日备份。
7. 在新目录恢复备份并验证登录、项目、媒体、任务。
8. 保存上一 release，进行冷回滚演练。
9. 公网扫描确认应用端口不可直接访问。

## 18. 提交与阶段门禁

每个实现提交必须注明：

- fixture ID。
- acceptance ID。
- TapNow source ID。
- 自动检查结果。
- 人工检查状态。
- 尚未解决的 `OPEN`。

任何阶段出现用户真实验收 FAIL：

- 当前阶段标记 `BLOCK`。
- 不用自动化 PASS 覆盖。
- 不进入下一阶段。
- 从共同事件路由、坐标转换或共享原语定位根因，避免逐节点打补丁。

## 19. 推荐实际开工批次

| 批次 | 内容 | 预计 |
|---|---|---:|
| B0 | 证据复制、SHA、冲突表、fixture runner | 2–3天 |
| B1 | 空 Shell 四视口 | 3–5天 |
| B2 | XYFlow 内核、选择、拖拽、resize、edge | 7–10天 |
| B3 | Text 全状态 | 4–6天 |
| B4 | Image 基础和生成状态 | 6–8天 |
| B5 | Image 高级编辑 | 7–10天 |
| B6 | Video、Audio、Playlist | 8–12天 |
| B7 | Storyboard、Group | 5–7天 |
| B8 | 搜索、素材、模板、历史、菜单 | 6–8天 |
| B9 | 服务端持久化、上传、任务 | 8–12天 |
| B10 | Agent、成员、权限 | 6–9天 |
| B11 | 全量验收、部署、恢复 | 5–7天 |

单人完整执行约 `14–18 周`。图片高级编辑和Storyboard/Table仍纳入完整复刻范围；Comment已由用户移出范围。

## 20. 当前实际进度与后续执行顺序（2026-08-01）

上面的B0～B11是开工时的历史估算，不再代表当前剩余工期。当前真实状态以`TASKS.md`和`TAPNOW_ACCEPTANCE_MATRIX.md`为准。

已经完成当前范围验收：

- 绿地工程、固定Shell、画布内核、节点、连线、菜单、素材、历史、Playlist、Group和外围面板。
- 管理员/普通用户两级账号、管理员模型中心、平台连接、生成安全和私有阿里云OSS新图片路由。
- OpenRouter GPT Image 2一次真实成功生成，结果私有保存、刷新保留和下载。
- 图片模型参数能力控制，以及图片连线参考图的缩略片、删除/撤销同步和安全`input_references`传参；`GEN-009`已于2026-08-01人工通过。

当前主线：

1. `GEN-007/DATA-004`：只使用已经存在的真实成功结果，停止并重新启动服务，确认画布结果、任务和历史恢复且不重复；该步不得调用Provider。
2. `GEN-006/OPEN-007`：真实失败、取消、超时和重试仍缺证据。优先寻找零费用验证方式；任何可能产生费用的测试必须单独征得用户许可。
3. 图片主链路可靠性收口后，接入一个真实Video模型；复用账号、模型目录、安全门禁、任务和私有OSS结构，不另造第二套系统。
4. Video人工验收通过后再接Audio。
5. 最后完成服务器HTTPS、回环监听、进程守护、自动备份、新目录恢复和冷回滚；部署前再次全量回归与人工验收。

明确不进入当前主线：

- `IMGEDIT-007`打光继续PAUSED，保留代码和验收记录但入口禁用。
- `AUTH-002/OPEN-009`团队、邀请、成员和多人协作继续PAUSED。
- `OPEN-019`Storyboard/Table完整创建编辑和`OPEN-021`真实Agent协议继续BLOCK，等待真实入口或后端授权。
- Comment、社区、TapTV、竞技场、额度/积分、链接分享继续N/A，不得恢复。
