# INC-UI-001 设置页返回来源画布与浏览器品牌标识修改方案

状态：`LOCAL_IMPLEMENTED_AUTO_PASS_USER_RECHECK / V0.6.2_CONFIRMED / PRODUCTION_UNCHANGED`

建立日期：`2026-08-15`

适用版本：用户已同意作为 `v0.6.2` 候选并授权实施；本地候选已完成且自动门通过。当前真实package、`v0.6.1`标签与生产制品保持不可变，本次授权不构成生产发布授权。

## 1. 用户目标

本增量一次解决两个相互独立、但都位于前端外壳层的问题：

1. 从任意真实项目画布进入「我的连接」或管理员设置页后，右上角「返回画布」必须返回进入设置前的那个项目画布，不得固定跳到不可删除的默认画布；旁边新增「返回工作空间」。
2. 浏览器标签不再只显示浏览器默认地球图标和笼统的「画布」，而是显示无央图标与当前页面/项目的准确标题。

本方案只覆盖前端导航、页面身份和相应零费用测试，不修改数据库、Provider、OSS、生成执行器、模板数据、权限合同或生产配置。

## 2. 当前代码证据与根因

### 2.1 设置页为什么总回默认画布

`client/src/App.tsx` 内以下 8 个完整页面各自硬编码了 `window.location.href = "/canvas"`：

- `/connections`：我的连接；
- `/admin/accounts`：账号管理；
- `/admin/models`：模型中心；
- `/admin/providers`：平台连接；
- `/admin/storage`：存储中心；
- `/admin/generation-safety`：生成安全；
- `/admin/api-contract`：自有接口说明；
- `/admin/templates`：公共模板管理。

`/canvas` 正是默认画布的规范地址，因此当前结果不是浏览器记错，而是前端明确写死。账号浮层进入这些页面时也只写固定路径，没有携带当前 `projectId`，设置页无法知道用户从哪个项目进来。

「修改密码」是画布内弹窗、「退出登录」是动作，不是独立设置页面，不纳入双返回按钮；其余上述完整设置页面全部纳入，避免只修截图中的「我的连接」。

### 2.2 项目来源能力已经存在但没有统一

项目现有能力可复用：

- `client/src/canvas/CanvasShell.tsx` 已按账号和标签页写入 `sessionStorage["unboundry:last-project:<userId>"]`；
- 画布项目菜单进入工作空间时已使用 `/canvas/projects?from=<projectId>`；
- `client/src/projects/WorkspacePage.tsx` 已读取 `from`、查询 `/api/projects` 并尝试返回来源项目。

但这些逻辑目前分散，账号浮层和设置页没有接入；工作空间在找不到来源时仍回落 `/canvas`，并且项目列表读取失败时会盲跳第一个候选。这两个兜底都不符合本次“不要自动返回默认画布”的规则。

### 2.3 浏览器标签为什么只有地球和「画布」

- `client/index.html` 只有固定 `<title>画布</title>`；
- 页面运行时没有统一更新 `document.title`；
- HTML 没有 `<link rel="icon">`，静态目录也没有 favicon，Chrome 因此显示默认地球图标；
- 产品实际无央无限符号已存在于 `client/src/styles.css` 的 `.replica-mark` data SVG 中，但没有作为浏览器图标资源复用。

## 3. 冻结产品规则

### 3.1 “返回画布”的含义

本增量中的“来源画布”专指当前账号下的真实项目 ID，不接受完整 URL、路径、域名或 JavaScript 字符串。

候选优先级固定为：

1. 当前设置/工作空间 URL 的 `?from=<projectId>`；
2. 当前标签页、当前账号的 `sessionStorage` 最近真实项目；
3. 都不存在或都已删除时留在/进入工作空间。

`default`、空值、非法编码、含 `/`、反斜杠、NUL 或超长值均不作为来源项目。也就是说：

- 从项目 A 进入设置页，返回 A；
- 设置页之间互相跳转，仍保留 A；
- 从默认画布进入设置页时，如本标签页曾打开真实项目 A，则返回 A；否则返回工作空间；
- 来源项目已删除时，尝试当前账号的最近真实项目；仍无可用项目则返回工作空间；
- 任何兜底都不再静默进入默认画布。

### 3.2 校验与失败规则

- 只把项目 ID 放进 `from`，不支持 `returnUrl`，从结构上避免开放重定向。
- 点击「返回画布」时，以当前登录态调用既有只读 `GET /api/projects`，只在候选 ID 属于当前账号项目列表时进入 `/canvas/<encoded-id>`。
- 项目列表读取失败属于暂时无法确认，不盲跳、不回默认画布；按钮恢复可点击并在当前页显示 `aria-live` 错误：“暂时无法确认原画布，请重试或返回工作空间”。
- 双击/连点只允许一个解析请求；离开页面时取消未完成请求，避免迟到导航。
- 账号切换天然隔离：storage key 带 `userId`，项目列表 API 也按当前登录账号过滤。

### 3.3 “返回工作空间”的含义

- 设置页右上角显示同一按钮组：`返回画布`、`返回工作空间`。
- `返回工作空间` 进入 `/canvas/projects?from=<有效候选项目>`；若没有候选则进入 `/canvas/projects`。
- 工作空间自身的「返回画布」改用同一解析器，因此 A → 设置 → 工作空间 → 返回画布仍回 A；没有有效来源时留在工作空间并给出明确提示，不跳默认画布。
- 两个按钮沿用项目现有灰度 UI、键盘 focus 样式和最小可点击区域，不引入新的彩色视觉系统。

## 4. 代码修改设计

### 4.1 新增一个小型共享导航模块

建议新增 `client/src/navigation/canvasReturn.ts`，集中提供纯函数与只读解析能力：

- `lastProjectStorageKey(userId)`；
- `parseSourceProjectId(search)`：只解析安全项目 ID并排除 `default`；
- `readLastProjectId(userId)` / `rememberLastProjectId(userId, id)`；
- `withCanvasSource(path, id)`：仅向站内固定路径附加编码后的 `from`；
- `resolveReturnProject({ userId, search, signal })`：查询 `/api/projects`，按 `from → session` 返回第一个仍存在的项目；
- `projectCanvasPath(id)` 与 `projectWorkspacePath(id?)`。

`CanvasShell.tsx`、`WorkspacePage.tsx`、账号浮层和设置页全部调用同一模块；删除现有重复的 storage key、`canvasPath` 和候选解析实现，防止以后四处规则漂移。

### 4.2 新增共享设置页页头

建议新增 `client/src/navigation/SettingsPageHeader.tsx`，参数只包含：

- 页面标题；
- 当前用户显示名；
- 当前用户 ID；
- 可选测试标识。

组件负责：

- 无央图标和原有标题/用户副标题；
- 「返回画布」异步校验、busy 防重、错误提示；
- 「返回工作空间」保留来源；
- 按钮组 `aria-label`、键盘顺序、focus 与 `aria-live` 状态。

`App.tsx` 的 8 个页面用该组件替换各自复制的 `<header>`，不改各页面表单、API、权限或数据加载逻辑。这样以后新增设置页不会再次写死 `/canvas`。

### 4.3 让所有入口传播来源项目

在 `AuthenticatedApplication` 中，账号浮层已经能获得当前 `projectId` 与 `status.user.id`：

- 当前是真实项目时，进入设置路由统一附带 `?from=<projectId>`；
- 当前是默认画布时，尝试读取当前账号、本标签页最近真实项目后附带；没有则不附带；
- 「工作空间」入口同样复用 `projectWorkspacePath`；
- 模型中心 ↔ 平台连接等设置页内部跳转必须继续携带当前 `from`，不能在第二跳丢失来源。

管理员权限 guard 和未登录跳转保持现有语义；非法 `from` 绝不影响鉴权结果。

### 4.4 统一工作空间返回逻辑

`WorkspacePage.tsx` 删除自己的候选拼装和 `/canvas` 默认兜底，改用共享解析器：

- 有效来源/最近项目：返回对应 `/canvas/:id`；
- 项目被删除：尝试下一个候选；
- 无候选：留在工作空间并提示“没有可返回的最近项目，请打开一个项目”；
- API 暂时失败：留页提示重试；
- 打开任意项目时继续写入本标签页最近项目。

默认画布卡片和 `/canvas` 的显式进入能力保持不变；本次只取消“返回动作的默认画布兜底”，不删除默认画布。

### 4.5 浏览器 favicon

新增 `client/public/favicon.svg`：

- 复用 `.replica-mark` 的无央无限符号路径和蓝白渐变；
- 增加深色圆角底以保证 Chrome 浅色标签栏仍清晰可见；
- 不从第三方下载图标，不新增授权来源。

在 `client/index.html` 增加：

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

HTML 首屏兜底标题改为 `无央｜AI 无限画布`，React 挂载后由动态标题接管。构建必须确认 `dist/client/favicon.svg` 存在且内容与源文件一致。

### 4.6 动态浏览器标题

建议新增一个极小的 `client/src/pageIdentity.ts`（或等价 hook），统一做标题归一化与 `document.title` 写入，避免每页自行拼字符串。

标题规则固定为：

| 页面 | 浏览器标题 |
|---|---|
| 真实项目画布 | `<项目名>｜无央` |
| 默认画布 | `默认画布｜无央` |
| 工作空间 | `工作空间｜无央` |
| 我的连接 | `我的连接｜无央` |
| 账号管理 | `账号管理｜无央` |
| 模型中心 | `模型中心｜无央` |
| 平台连接 | `平台连接｜无央` |
| 存储中心 | `存储中心｜无央` |
| 生成安全 | `生成安全｜无央` |
| 公共模板管理 | `公共模板管理｜无央` |
| 自有接口说明 | `接口说明｜无央` |
| 登录/初始化 | `登录｜无央` |

真实项目标题由 `CanvasShell` 已有的 `projectTitleControl.value` 驱动：水化完成后显示服务端/本地最终标题，重命名输入变化时同步更新标签，保存失败不改写项目持久事实但标签仍反映当前可见草稿；刷新后重新以持久标题为准。空白标题使用“未命名项目”，并折叠换行/控制字符，避免标签不可读。

## 5. 预计文件范围

功能文件：

- `client/src/App.tsx`；
- `client/src/canvas/CanvasShell.tsx`；
- `client/src/projects/WorkspacePage.tsx`；
- `client/src/navigation/canvasReturn.ts`（新增，名称可在实施时按项目风格微调）；
- `client/src/navigation/SettingsPageHeader.tsx`（新增）；
- `client/src/pageIdentity.ts`（新增或并入前述模块）；
- `client/src/styles.css`；
- `client/index.html`；
- `client/public/favicon.svg`（新增）。

测试与文档：

- 优先扩展 `tests/m66-multi-project.spec.ts` 覆盖来源链与删除/账号隔离；
- 扩展适合的已登录 UI spec 覆盖 8 个设置页共享页头、内部跳转、标题与 favicon；若既有 spec 会造成跨领域耦合，再新增一个单一职责 safe spec；
- 同步 safe runner 发现清单所要求的测试元数据；
- 更新 `TASKS.md`、验收矩阵、施工断点和交接摘要。

禁止触及：`server/`、`types/`、数据库迁移、真实数据目录、Provider/OSS 配置、公共模板数据和生产目录；若实施中发现确实需要服务端改动，必须停止并先更新方案，不得借本增量扩 scope。

## 6. 自动测试矩阵

所有测试只允许 `scripts/run-safe-tests.mjs`、新临时数据目录和动态 loopback 端口；不得使用 4173、`app/data`、真实 Provider/OSS 或非 loopback 网络。

### 6.1 导航主路径

1. 创建项目 A，从 A 打开每类设置页，URL 含 `from=A`。
2. 点击「返回画布」只读校验后进入 `/canvas/A`，节点/项目 ID 不变。
3. A → 模型中心 → 平台连接 → 返回画布，第二跳仍回 A。
4. A → 设置 → 返回工作空间，URL 为 `/canvas/projects?from=A`；工作空间再返回画布仍为 A。
5. 直接打开 `/connections`，当前标签 session 最近项目为 A，返回 A。
6. 从默认画布进入设置页，session 有 A 时返回 A；session 无真实项目时进入/留在工作空间，绝不因兜底进入 `/canvas`。

### 6.2 异常与安全路径

1. `from` 为已删除项目 A、session 为有效 B：返回 B。
2. A 与 session 项目都已删除：返回工作空间。
3. `from=default`、URL、`//evil.example`、非法百分号、斜杠、NUL、超长值均被拒绝，不能形成站外导航。
4. `/api/projects` 返回 401/403/500、超时或畸形 JSON：留在当前页显示明确错误，不跳默认画布、不盲跳候选。
5. 快速双击返回按钮只发一个项目列表请求并只导航一次。
6. 用户 A 的 session 项目不能在用户 B 登录后作为有效返回目标。
7. 权限不足进入管理员路由仍按现有 guard 重定向，`from` 不绕过权限。

### 6.3 页面和品牌

1. 8 个完整设置页都存在两个相邻按钮，旧单按钮硬编码为 0 处。
2. 两按钮在键盘 Tab、Enter、Space、focus-visible 和 busy 状态下可用且不溢出页头。
3. 工作空间、默认画布、项目 A、全部设置页和登录页标题逐项匹配表格。
4. 项目 A 重命名后标签立即变为新标题；刷新后仍来自持久标题。
5. `/favicon.svg` 在开发/构建产物中返回 200、`image/svg+xml`，源/构建字节一致；HTML 存在唯一 favicon link。
6. 浅色浏览器标签栏人工确认无限符号清晰，不能只依赖自动 200 判断视觉通过。

### 6.4 零副作用断言

- generation tasks、Provider attempts、媒体、模板和数据库 schema 均不因测试增加；
- 真实 Provider/付费请求为 0；
- 真实 OSS 请求为 0；
- 4173 listener 身份和真实路径访问审计前后不变；
- 临时目录、动态端口和受管进程全部清理。

## 7. 实施顺序与每步停止点

1. **文档冻结（已完成）**：建立本方案、TASKS 记录、验收行和断点。
2. **失败先行测试**：补来源传播、回退、权限、标题和 favicon 断言，确认旧代码按预期失败；不得运行真实页面/真实数据。
3. **共享导航实现**：实现 ID 解析、session 隔离、只读项目校验和站内路径构造，先跑纯函数/导航定向。
4. **页面接线**：共享设置页头覆盖 8 页，账号浮层和设置页内部跳转传播 `from`，工作空间复用解析器。
5. **品牌接线**：favicon、静态兜底标题和动态标题；项目重命名联动。
6. **安全验证**：TypeScript、精确受影响 spec、生产 build；随后才运行安全 full。任何失败都重新归因，不沿用旧基线豁免。
7. **用户实页验收（待执行）**：候选发布到用户可访问环境后，由用户确认两个返回按钮、A 项目闭环、标签标题和图标。
8. **版本与发布（待授权）**：`v0.6.2`候选版本已经用户确认；生产发布仍须单独取得授权。未经发布授权，不改生产、不tag、不merge Draft PR。

## 8. 验收条目

| ID | 优先级 | 验收合同 | 计划状态 |
|---|---|---|---|
| NAV-001 | P0 | 设置页返回进入前的有效真实项目，不固定回默认画布 | USER_RECHECK |
| NAV-002 | P0 | 8 个设置页共享双返回按钮，设置页之间传播来源 | USER_RECHECK |
| NAV-003 | P0 | 工作空间闭环保留来源；删除/无来源/网络失败不误跳默认画布 | USER_RECHECK |
| NAV-004 | P0 | `from` 只接受当前账号项目 ID，无开放重定向、账号串线和重复导航 | USER_RECHECK |
| BRAND-001 | P1 | 浏览器显示无央 favicon，开发与构建产物均存在 | USER_RECHECK |
| BRAND-002 | P1 | 画布、工作空间、设置页和登录页使用准确动态标题 | USER_RECHECK |
| BRAND-003 | P1 | 项目重命名即时更新标签，刷新后与持久标题一致 | USER_RECHECK |

自动测试完成最多进入 `USER_RECHECK`；必须由用户在可见浏览器确认真实导航与 favicon 后才能记 `PASS`。

## 9. 发布、回滚与 Git 边界

- 当前生产继续是 `v0.6.1/schema39`；`v0.6.1` 标签不可移动。
- 下一版本候选`v0.6.2`已经用户确认；真实package暂不改版，留到正式发布候选准备阶段统一处理。
- 当前 Draft PR #1 继续保持 Draft；若后续获准commit/push，必须同步更新PR标题/正文和验证证据。
- 功能回滚是恢复前端上一不可变制品；本增量没有数据库回滚或数据迁移。
- 用户已授权并完成当前功能代码与隔离验证；没有授权commit、push、tag、PR更新、SSH或生产发布。

## 10. 上下文恢复卡

若上下文压缩或换 Agent，按以下顺序恢复：

1. 阅读仓库根 `AGENTS.md`；
2. 阅读 `README.md`、施工总方案和 `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`；
3. 完整阅读本文件；
4. 读取 `TASKS.md` 的 `INC-UI-001` 段和验收矩阵的 NAV/BRAND 行；
5. 只读核对仓库 `/Users/mymy/Documents/unboundry/app`、分支、HEAD、工作树、package 与 Node；
6. 当前状态应为 `LOCAL_IMPLEMENTED_AUTO_PASS_USER_RECHECK / PRODUCTION v0.6.1 UNCHANGED`；
7. 不重复实施；下一步只在用户明确授权后准备/发布候选，再由用户完成可见实页验收。commit、push、tag、PR更新与生产发布仍须服从最新授权。

恢复时必须先复述三条不可漂移规则：

- 返回目标按 `from → 当前账号本标签最近真实项目 → 工作空间`；
- 永不把默认画布作为返回动作的隐式兜底；
- 来源只保存项目 ID，并通过当前账号 `/api/projects` 只读校验。
