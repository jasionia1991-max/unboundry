# INC-IMGEDIT-004 图片工具交互与 UI 返工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-24 03:14:00 +0800
- 状态：`GOAL_ACTIVE / R1_IN_PROGRESS / UI_REMEDIATION_REQUIRED`
- 当前阶段：`R1 状态机和共享宿主合同 / IN_PROGRESS`
- 唯一允许的下一动作：冻结 ActiveImageTool、descriptor、host/modal/popover/surface、焦点、busy、关闭、inert 和 z-index 合同；在既有直接规格中先补会在旧实现稳定失败的叠层、viewport 和透明 surface 证据，不提前实现 R2 UI 宿主
- 当前仓库：`/Users/mymy/Documents/unboundry/app`
- 文档分支：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24`
- 立项 HEAD / origin-main：`f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- package：`0.6.35`
- schema：`39`
- 生产：`v0.6.35 / PRODUCTION_PUBLISHED_AUTO_PASS / REAL_PROVIDER_TECHNICAL_SMOKE_PASS / USER_QUALITY_REMEDIATION_REQUIRED`
- 用户质量：未通过；没有 `USER_PASS`
- 目标版本：`v0.6.35 / VERSION_GATE_VALID`
- 发布授权：用户于本 Goal 独立明确“`v0.6.35 上线`” / `RELEASE_GATE_VALID`
- 真实 Provider/付费预算：`0次 / 0 USD`
- 产品代码：未修改
- 测试代码：未修改
- 文档范围：本方案、Checkpoint、Goal 提示词、AGENTS、上线规矩、CURRENT_STATE、TASKS、验收矩阵

## 1. 权威恢复顺序

每次新 Session、上下文压缩、换 Agent 或自动续跑后，完整阅读：

1. `/Users/mymy/Documents/unboundry/app/AGENTS.md`
2. `/Users/mymy/Documents/unboundry/app/上线规矩.md`
3. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_CURRENT_STATE.md`
4. `/Users/mymy/Documents/unboundry/app/README.md`
5. `/Users/mymy/Documents/unboundry/app/TASKS.md` 顶部当前区块
6. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_PLAN_2026-08-24.md`
7. 本 Checkpoint
8. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 顶部及 `IMGEDIT-001～028`
9. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`
10. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md`，重点第8节图片高级编辑
11. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_PLAN_2026-08-23.md`
12. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_003_IMAGE_TOOLBAR_FUNCTIONALIZATION_CHECKPOINT.md` 顶部、D13与预算账本
13. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_002_CROP_LOADING_EXPERIENCE_PLAN_2026-08-23.md`
14. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_PLAN_2026-08-21.md`
15. `/Users/mymy/Documents/unboundry/app/spec/UNBOUNDRY_PROGRESSIVE_MODULARIZATION_CHECKPOINT.md`
16. `/Users/mymy/Documents/unboundry/app/spec/INC_IMGEDIT_004_IMAGE_TOOL_UI_REMEDIATION_GOAL_PROMPT_2026-08-24.md`

如果 `AGENTS.md` 要求额外文件，继续完整阅读，不得缩减。

## 2. 恢复后只读核对

```bash
pwd
git branch --show-current
git rev-parse HEAD
git status --short
git fetch origin main --prune
git rev-parse origin/main
git log -5 --oneline --decorate
node --version
npm --version
node -p "require('./package.json').version"
```

同时核对：

- 当前分支是否从最新 `origin/main` 建立；
- 是否只有已知文档改动和受保护未跟踪 JSON；
- package、schema、生产和历史 INC-IMGEDIT-003 状态是否一致；
- 版本号和发布句子是否由用户在新 Session 明确填写；
- 真实 Provider 预算仍为 0；
- 是否存在其他 Agent 或工作树正在改相同文件。

任何不一致先写入本 Checkpoint，不得凭记忆继续。

## 3. 受保护文件

`spec/public-templates-director-split-revision.json` 永久禁止读取、修改、格式化、暂存、提交、删除或改名。

禁止 `git reset --hard`、`git clean`、覆盖用户数据或对宽泛目录执行破坏性清理。

## 4. 已确认缺陷基线

| 缺陷 | 等级 | 初始证据 |
|---|---:|---|
| 多个图片工具可同时叠开 | P0 | 生产只读浏览器观察；源码存在多个独立 open 状态 |
| 快速切分/Seedance/多角度底部裁切 | P0 | 目标视口截图与 DOM |
| 重绘/擦除未隔离底层 Creator | P0 | 生产截图；遮罩层过弱 |
| 透明图在编辑器/全屏显示黑底 | P1 | 生产透明抠图结果实页 |
| 标注舞台窄、文字工具栏不符合规范 | P1 | 生产截图与参考目录 |
| 扩图底部控件拥挤 | P1 | 生产截图 |
| 紧凑面板与 Creator 重叠、栅格失衡 | P1 | 调整像素/增强/抠图实页 |
| 顶部工具栏和更多菜单基本符合基线 | 回归保护 | 生产只读截图 |

## 5. 阶段总表

| 阶段 | 内容 | 状态 |
|---|---|---|
| R0 | 实时恢复与缺陷基线 | AUTO_PASS |
| R1 | 状态机和共享宿主合同 | IN_PROGRESS |
| R2 | 单一活动工具与 Portal 宿主 | NOT_STARTED |
| R3 | 紧凑面板和快速切分 | NOT_STARTED |
| R4 | 大型编辑器与透明舞台 | NOT_STARTED |
| R5 | 全屏与交互完整性 | NOT_STARTED |
| R6 | 逐工具功能与回归验证 | NOT_STARTED |
| R7 | 候选冻结与独立审查 | NOT_STARTED |
| R8 | GitHub 与生产发布 | NOT_STARTED / GATES_VALID |
| R9 | 生产零付费验收与用户复验 | NOT_STARTED |

同时最多一个阶段为 `IN_PROGRESS`。

## 6. 验收条目

| ID | 内容 | 状态 |
|---|---|---|
| IMGEDIT-021 | 单一活动工具状态机与叠层阻断 | NOT_STARTED |
| IMGEDIT-022 | screen-space 宿主与 viewport 安全 | NOT_STARTED |
| IMGEDIT-023 | 透明图片统一棋盘格与 contain | NOT_STARTED |
| IMGEDIT-024 | 重绘/擦除/扩图/标注大型编辑层 | NOT_STARTED |
| IMGEDIT-025 | 多角度/调整像素/快速切分/增强/抠图/Seedance 面板 | NOT_STARTED |
| IMGEDIT-026 | Escape、焦点、键盘、IME、busy 与 reduced-motion | NOT_STARTED |
| IMGEDIT-027 | 既有工具栏、菜单、颜色、裁剪、下载回归 | NOT_STARTED |
| IMGEDIT-028 | 目标视口与真人逐项功能验收 | NOT_STARTED |

## 7. 版本、发布和外部调用门

- 本 Goal 目标版本由用户明确填写为 `v0.6.35`，版本门有效；
- 用户另行明确“`v0.6.35 上线`”，发布门有效；
- 两项门只允许在 R7 通过后进入 R8，不提前产生候选或发布结论；
- INC-IMGEDIT-003 的 v0.6.34/v0.6.35 授权和 6 次/60 USD 预算均已消费；
- 本 Goal 默认真实 Provider、真实付费生成和新增 OSS 测试写入均为 0；
- UI 返工不得为“验证按钮”再次生成图片。

## 8. 文档驱动纪律

- 开始阶段前先把该阶段改为 `IN_PROGRESS`；
- 完成阶段后先回写本文件、验收矩阵和 TASKS，再进入下一阶段；
- CURRENT_STATE 只在候选、GitHub、版本或生产事实变化时更新；
- 每条测试证据记录命令、Node/npm、范围、结果和退出码；
- 树未变化时复用有效结果，不重复 full；
- 上下文压缩后停止编辑，重新读取和核对，只从唯一下一动作继续；
- 普通失败不能把阶段标为 BLOCKED；
- 自动、浏览器 Agent、生产技术和用户确认必须分层。

## 9. 阶段更新模板

```text
时间：
阶段：R?
状态：IN_PROGRESS / AUTO_PASS / USER_RECHECK / BLOCKED
branch / HEAD / origin-main：
工作树摘要：
产品文件：
测试文件：
文档文件：
package / schema / candidate：
版本门 / 发布门：
Provider / OSS / 费用：
测试命令、环境、结果、退出码：
浏览器视口、zoom、素材与结果：
架构与数据风险：
设计偏差：
阻断：
回滚点：
唯一下一动作：
```

## 10. PRE_GOAL 落档记录

- 只读核对时 `/app` 原工作树停在旧 INC-IMGEDIT-003 bootstrap 分支；`origin/main` 已为 `f369d1d`、package 0.6.35。
- 已安全创建 `codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` 并对齐 `origin/main`；受保护 JSON 继续只作为未跟踪文件存在，没有读取其内容。
- 本轮只建立文档驱动合同并同步当前状态，不修改产品、测试、schema、Provider、OSS 或生产。
- 用户要求新 Session 一次性解决并授权普通施工动作；具体版本号和独立发布句子仍须在新 Session Goal 中填写。
- 文档静态检查`git diff --check`退出0；当前身份残留扫描未再命中旧`1/6`、`REMAINING_ACTION_TIME_CONFIRMATION_PENDING`或`仅剩用户视觉质量复验`。`CURRENT_V0_6_35_USER_RECHECK`继续作为项目现有版本一致性测试要求的治理标记保留，具体用户事实由`USER_QUALITY_REMEDIATION_REQUIRED`正文和INC-IMGEDIT-004断点表达。
- 使用Node22.23.1/npm10.9.8尝试安全定向`node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`：preflight、76条架构基线和离线依赖安装通过，随后在任何产品spec执行前被仓库既有ignored `backups/`目录的direct-write负控以`EISDIR`停止，退出1；产品测试执行数0，source snapshot `f76e4420…d8c027`和4173 listener `24c91e57…7b8244`均unchanged，临时suite已清理。未删除/移动备份、未绕过safe runner、未把本次尝试记为测试PASS，也未重复full。
- 唯一下一动作保持：新 Session 启动 Goal 后执行 R0，不得跳过。

## 11. R0 实时恢复与缺陷基线

- 时间：2026-08-24 03:06:07 +0800
- 阶段：`R0`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：只有 INC-IMGEDIT-004 立项治理文档改动和三份新文档；受保护 JSON 继续是未跟踪文件且不在 diff/stage；其他 linked worktree 没有同范围施工证据。现有 `127.0.0.1:4173` 进程视为用户既有服务，只记录 listener 指纹，不停止、不复用
- 产品文件：无修改；只读核对 `client/src/canvas/ImageNode.tsx`、`client/src/imageTools/*` 和 `client/src/styles.css`
- 测试文件：无修改；直接相关既有规格为 `tests/m2-image-node.spec.ts`、`tests/m100-modular-ports.spec.ts`
- 文档文件：本 Checkpoint、验收矩阵、TASKS；PRE_GOAL 已有方案/Goal/治理文档保持
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；用户独立明确“v0.6.35 上线” / `RELEASE_GATE_VALID`
- Provider / OSS / 费用：真实 Provider 请求、尝试、成功均 0；费用 0；真实 OSS 写入 0；历史 6/6、60 USD 不复用
- 测试命令、环境、结果、退出码：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs preflight`，Node22.23.1/npm10.9.8，120 specs，`preflight-pass`，退出0；4173 listener `24c91e57…8244` unchanged。R0 未运行产品spec或full
- 浏览器视口、zoom、素材与结果：R0 不制造新页面状态；生产只读 GET 实时返回 version0.6.35、live、ready active/schema39。目标视口/zoom/透明素材矩阵留给 R6 冻结后实页验收
- 架构与数据风险：源码确认 `ImageNode` 仍维护 crop/fullscreen/multi-angle/redraw/erase/outpaint/enhance/cutout/seedance/annotation/localTool 等多组独立 open state；紧凑面板和多角度仍依赖 NodeToolbar 节点相对定位；redraw/erase/annotation/outpaint 各自创建固定 overlay，缺少统一 inert/focus/top-layer 合同。业务 Dispatcher、Generation/Media/Canvas/Library/Provider 链不需要改动
- 设计偏差：无。生产探针首轮 shell 循环误用了 zsh 特殊变量名导致当前 shell PATH 被覆盖，三个命令均未执行；改用非保留变量和绝对 curl 后三项只读探针全部成功，未产生写请求
- 阻断：无
- 回滚点：`origin/main@f369d1dba1eef05aebc7f1a443256ceb82778ea0`；R0 只有治理文档改动，无产品、测试、schema、Provider、OSS 或生产变化
- 唯一下一动作：提交 R0 本地 checkpoint；随后把 R1 标为 `IN_PROGRESS`，先冻结合同并补失败测试，不提前实现 R2
