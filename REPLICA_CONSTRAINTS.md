# Unboundry 私有复刻工程约束

状态：`MANDATORY`  
适用范围：本仓库全部代码、资源、测试、部署和验收。

## 1. 绿地隔离

- 本仓库必须从空仓库独立实现。
- 禁止导入、复制、粘贴、改写、包装或嵌入 Lumino/Lumino Web 的画布代码。
- 禁止共享 Lumino 的数据库、schema、媒体目录、账号、端口、服务、Provider 配置、环境变量、备份和部署单元。
- 禁止以 Lumino 的页面、截图、测试或现有行为作为产品正确性的证据。
- 实现工作不得以阅读 Lumino 代码来决定 Unboundry 的产品逻辑。
- 历史仓库中的真实 Unboundry 截图和 DOM 调研可以作为证据，但必须先登记到
  `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`；不得连带采用 Lumino 实现。
- 通用开源依赖可以使用，但必须从其官方包和文档独立接入。

## 2. 唯一事实源

产品行为按以下顺序裁决：

1. 用户对真实 Unboundry 的直接验收。
2. `../UNBOUNDRY_CANVAS_FULL_SURVEY_2026-07-27.md`。
3. `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md` 中登记的 Unboundry 截图、DOM 坐标、录像和网络证据。
4. `spec/unboundry-state-fixtures.json`。
5. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`。
6. `spec/UNBOUNDRY_DETAILED_IMPLEMENTATION_METHOD.md`。

证据不足时标记 `OPEN`；禁止用猜测或“行业常见做法”伪装成 Unboundry 行为。

## 3. 一比一要求

- 稳定 UI 元素的坐标误差不得超过 `1 CSS px`。
- 字体、颜色、边框、圆角、阴影、模糊、层级、hover、focus、disabled、loading、success 和 error 必须逐状态验收。
- 所有指针交互必须用真实鼠标/触控板补验，不能只依赖 DOM 事件注入。
- 自动化结果不能推翻用户真实浏览器的失败结论。
- Text、Image、Video、Audio、Playlist、Group、Storyboard/Table、Comment
  必须独立实现产品逻辑；只能共享无业务判断的小型视觉原语。
- 只有经Unboundry实页或用户验收确认在两类以上节点中完全相同的规则，才能提取为共享实现；节点独有的菜单、生成参数和播放逻辑不得强行共用。
- Image和Video上传本地视觉素材后统一保持原始比例：横向素材高为250，竖向素材宽为250；必须复用 `fitVisualMediaSize`，不得在各节点重复计算。
- Image、Video和Audio已有本地素材后统一隐藏左侧加号、保留右侧加号；素材预览不得拦截节点拖动，只有播放、替换等明确按钮可以拦截。
- 原始比例规则只适用于Image和Video；Audio不参与视觉素材比例计算。

## 4. 隐私与部署

- 只供本人和受邀朋友使用。
- 应用默认只监听回环地址或私有网络。
- 不提供公网注册、公共分享或搜索引擎入口。
- Provider 密钥不得进入浏览器、仓库、日志、夹具或聊天记录。
- 上传、下载和媒体预览必须经过成员权限校验。

## 5. 品牌与内容

- 不复制 Unboundry 私有源码、密钥、商标、Logo、角色图片或官方模板内容。
- 可以复刻可见的信息架构、尺寸、坐标、交互和功能逻辑。
- 私有部署不需要的社区、充值、公开发布能力必须明确标记 `N/A`，不得伪造。

## 6. 变更门禁

每个阶段合并前必须：

- 标明对应的 fixture ID 和 acceptance ID。
- 通过该阶段的坐标、截图、交互、持久化或安全检查。
- 记录仍为 `OPEN` 的 Unboundry 行为。
- 确认没有新增 Lumino 实现路径、依赖、复制资源或共享运行时；证据目录中
  明确标记的只读 `upstream` 来源不属于实现依赖。

违反本文件的实现不得合并，应删除后按绿地方式重做。
