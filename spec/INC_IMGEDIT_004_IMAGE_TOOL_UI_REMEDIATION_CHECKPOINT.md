# INC-IMGEDIT-004 图片工具交互与 UI 返工 Checkpoint

## 0. 当前断点

- 更新时间：2026-08-24 05:27:46 +0800
- 状态：`GOAL_ACTIVE / R8_IN_PROGRESS / LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS / UI_REMEDIATION_REQUIRED`
- 当前阶段：`R8 GitHub 与生产发布 / IN_PROGRESS`
- 唯一允许的下一动作：只读核对`v0.6.35`现有本地/远端tag、GitHub release、origin/main tree和生产release身份；若同名不可变发布已绑定不同源码且Runbook没有合法同版本热修路径，先把阻断证据、恢复条件和唯一下一动作写回本Checkpoint，不移动tag、不覆盖release、不自行选择新版本
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
- 产品代码：单一活动状态、Portal Host、modal inert、焦点返回、共享surface，以及六类紧凑/大型安全面板已实现；R7独立审查的五项发现已按最小范围修正
- 测试代码：m2已直接覆盖Host/inert/surface/焦点返回、三目标视口、全部12工具四档zoom、busy焦点、标注tooltip、无asset裁剪fail-closed和零生成请求
- 文档范围：Checkpoint、TASKS、验收矩阵、CURRENT_STATE候选事实；最终本地候选`161f417e401e6ad332a756510fc6e4c59136b972`，唯一一次safe full原始`1050/1052`，两项失败完成最小定向修正复验且未执行第二次full

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
| R1 | 状态机和共享宿主合同 | AUTO_PASS_WITH_EXPECTED_RED_UI_EVIDENCE |
| R2 | 单一活动工具与 Portal 宿主 | AUTO_PASS |
| R3 | 紧凑面板和快速切分 | AUTO_PASS |
| R4 | 大型编辑器与透明舞台 | AUTO_PASS |
| R5 | 全屏与交互完整性 | AUTO_PASS |
| R6 | 逐工具功能与回归验证 | AUTO_PASS / LOCAL_BROWSER_PASS |
| R7 | 候选冻结与独立审查 | AUTO_PASS / LOCAL_ENGINEERING_COMPLETE / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS |
| R8 | GitHub 与生产发布 | IN_PROGRESS / GATES_VALID / IMMUTABLE_IDENTITY_PREFLIGHT |
| R9 | 生产零付费验收与用户复验 | NOT_STARTED |

同时最多一个阶段为 `IN_PROGRESS`。

## 6. 验收条目

| ID | 内容 | 状态 |
|---|---|---|
| IMGEDIT-021 | 单一活动工具状态机与叠层阻断 | AUTO_PASS |
| IMGEDIT-022 | screen-space 宿主与 viewport 安全 | TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-023 | 透明图片统一棋盘格与 contain | TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-024 | 重绘/擦除/扩图/标注大型编辑层 | TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-025 | 多角度/调整像素/快速切分/增强/抠图/Seedance 面板 | TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-026 | Escape、焦点、键盘、IME、busy 与 reduced-motion | TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-027 | 既有工具栏、菜单、颜色、裁剪、下载回归 | TARGETED_AUTO_PASS / LOCAL_BROWSER_PASS |
| IMGEDIT-028 | 目标视口与真人逐项功能验收 | LOCAL_BROWSER_PASS / USER_RECHECK |

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

## 12. R1 状态机和共享宿主合同

- 时间：2026-08-24 03:11:52 +0800
- 阶段：`R1`
- 状态：`AUTO_PASS_WITH_EXPECTED_RED_UI_EVIDENCE`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 合同提交 `16b0acad9261394f1f33b90108d01a6c7ad06abb` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：R0提交`6b1109d`后，R1新增纯UI合同与既有两份直接规格断言；产品运行时尚未接宿主，故m2保持预期红。受保护JSON仍未跟踪且未进入提交
- 产品文件：`client/src/imageTools/imageToolUiContract.ts`；冻结12个活动工具、modal/popover分类、checkerboard/plain surface、inert/outside-close/max-width descriptor和原子菜单互斥reducer。未新增fetch、Provider、Generation、Media、Canvas或Library编排
- 测试文件：`tests/m100-modular-ports.spec.ts`扩展既有合同用例；`tests/m2-image-node.spec.ts`扩展既有图片基础用例，不增加spec或测试总数
- 文档文件：本Checkpoint、验收矩阵、TASKS
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0
- 测试命令、环境、结果、退出码：原工作树safe run因既有ignored `backups/` direct-write负控在产品spec前以EISDIR退出1，source/listener unchanged；未删除或移动备份。随后从精确提交`16b0aca`建立本Goal专用detached临时worktree并离线安装依赖：m100 `13/13 PASS`、退出0；m2按预期`9/10 PASS`、退出1，唯一失败是新增R1断言，精确证明旧运行时没有`ImageToolHost`、modal未给`#root`设置inert、cutout没有共享`ImageToolSurface`。两次source/snapshot `34c881c9…2cc5` unchanged、4173 listener `24c91e57…8244` unchanged；临时worktree已安全移除
- 浏览器视口、zoom、素材与结果：m2旧实现红证据来自隔离Playwright浏览器；R1未宣称viewport矩阵通过。R2后先复验同一最小用例
- 架构与数据风险：descriptor与reducer只管理可见UI状态，不持有业务payload、任务、上传或轮询；Host必须继续限制为Portal、互斥、焦点、关闭、inert、z-index和viewport
- 设计偏差：快速切分正式冻结为modal/checkerboard大型安全壳层，不再作为420px节点相对popover；全屏纳入同一modal host但继续保持产品内查看器
- 阻断：无；m2失败是施工前必须保留的确定性红证据，不是环境或外部阻断
- 回滚点：R0提交`6b1109d7bafc5288f7b4547d22ea7387c783699f`；R1合同提交`16b0acad9261394f1f33b90108d01a6c7ad06abb`
- 唯一下一动作：提交R1文档checkpoint；随后把R2标为`IN_PROGRESS`，实现Host并只复验m2/m100最小集合

## 13. R2 单一活动工具与 Portal 宿主

- 时间：2026-08-24 03:24:31 +0800
- 阶段：`R2`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终被测`c5f9795e178f0a198f333fd49b13efbf6e082ef4` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：产品、测试和R2启动断点已分三次本地checkpoint提交；当前仅受保护JSON未跟踪且未进入diff/stage。R2隔离测试worktree均由本Goal精确创建并已安全移除
- 产品文件：`client/src/canvas/ImageNode.tsx`以单一reducer活动状态取代annotation/crop/fullscreen/multi-angle/redraw/erase/outpaint/enhance/cutout/seedance/localTool等独立open状态；`client/src/imageTools/ImageToolHost.tsx`统一Portal、screen-space、popover flip/shift/clamp、modal inert、焦点循环/返回、Escape和共享Surface；Annotation/Crop/Redraw/Outpaint移除各自Portal，业务Dispatcher/use case不变；`client/src/styles.css`加入Host/surface/focus/reduced-motion基础壳层
- 测试文件：`tests/m2-image-node.spec.ts`在既有图片基础用例内直接断言Host唯一活动工具、modal时`#root inert`、关闭后恢复、触发按钮焦点返回和cutout共享surface；m100的R1合同断言继续覆盖reducer/descriptor边界
- 文档文件：本Checkpoint、验收矩阵、TASKS；CURRENT_STATE没有候选、GitHub、版本或生产事实变化，按纪律不改
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`，仍只允许R7通过后进入R8
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0；浏览器规格只使用临时fixture和动态loopback
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8；精确提交`661a7a4`隔离worktree中safe m2 `10/10 PASS`、m100 `13/13 PASS`，均退出0，source/snapshot`b8168929…5e674`、4173 listener unchanged。加强焦点断言后的`b63489e`首次m2为`9/10`，唯一失败精确证明工具栏因modal期间卸载导致旧触发元素断连、焦点无法返回；修正为保留底层toolbar DOM并依靠root inert阻止交互后，最终精确提交`c5f9795`只复验m2 `10/10 PASS`、退出0，source/snapshot`6a3e4445…33f1e`、listener unchanged。未重复m100或full
- 浏览器视口、zoom、素材与结果：m2隔离Playwright在现有fixture验证fullscreen/outpaint modal、cutout popover、裁剪/重绘既有交互和零Generation/Provider；R2不冒充三视口/四zoom完整矩阵，留给R3～R6
- 架构与数据风险：Host只管理可见层、互斥、焦点、关闭、z-index和viewport，不持有业务payload、任务、上传、轮询或Media/Canvas写入；m2既有crop/redraw/本地工具链和m100架构门通过，未修改Provider/Generation/Media/Canvas/Library合同
- 设计偏差：快速切分按R1合同进入modal checkerboard安全壳层；实现开始时新Host文件的首个未提交补丁早于Checkpoint切为R2 `IN_PROGRESS`数分钟，发现后立即先回写R2启动断点再继续，未开启第二阶段、未产生测试或外部副作用；此顺序偏差已如实记录
- 阻断：无
- 回滚点：R1文档提交`4ecb62bc51d9da72b201e14f931c56560ca594d0`；R2产品提交`661a7a4`、焦点测试提交`b63489e`、修正提交`c5f9795`
- 唯一下一动作：提交R2文档checkpoint；随后先把R3标为`IN_PROGRESS`，完成六类紧凑/大型安全面板和viewport-safe动作区

## 14. R3 紧凑面板和快速切分

- 时间：2026-08-24 03:36:12 +0800
- 阶段：`R3`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终被测`1dd3fa5440436d89fe9383701d84f6a9b26e8614` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：R3产品和测试已提交；测试使用本Goal精确创建的detached临时worktree，完成后已安全移除。当前只剩受保护JSON未跟踪且不在diff/stage；v0.6.32旧receipt worktree的同名历史改动mtime停在2026-08-23，当前无同范围测试或施工进程
- 产品文件：`client/src/canvas/ImageNode.tsx`、`client/src/imageTools/LocalImageToolPanels.tsx`、`client/src/styles.css`；六类面板统一header/body/footer和14/12px灰阶壳层，调整像素/快速切分busy同步给Host，快速切分改为920px大型sheet，多角度移除随节点缩放的`scale(0.819)`并保持600×308 screen-space布局
- 测试文件：`tests/m2-image-node.spec.ts`；在既有10个spec内加入panel/footer viewport bounds，覆盖1280×720、1440×900、1728×900下多角度、调整像素、快速切分、增强、抠图和Seedance，保持测试总数1052不变
- 文档文件：本Checkpoint、验收矩阵、TASKS；CURRENT_STATE没有候选、GitHub、版本或生产事实变化，按纪律不改
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`，仍只允许R7通过后进入R8
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0；m2仅使用临时fixture、动态loopback和fake能力/任务
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8。首个`39c98a8`隔离safe m2因Seedance新header关闭按钮让旧非精确“关闭”locator命中两个元素而`9/10`、退出1；产品行为和其余9项通过。只把既有footer locator收紧为`exact:true`后，最终精确提交`1dd3fa5`复验safe m2 `10/10 PASS`、退出0；同树safe m18 `2/2 PASS`、退出0。source/snapshot均`288cea88…0ddf`、4173 listener `24c91e57…8244` unchanged；未运行m100或full
- 浏览器视口、zoom、素材与结果：m2隔离Playwright真实打开六类面板，逐一断言panel和固定footer的left/top/right/bottom不越viewport；三视口均有直接覆盖。R3不冒充四zoom、横竖方透明素材和大型编辑器完整矩阵，留给R4～R6
- 架构与数据风险：只重排现有UI和本地busy可见状态；Dispatcher、operation payload、Generation/Media/Canvas/Library/Provider、schema和安全Blob合同未改。快速切分仍使用原子批量Canvas命令，生成式按钮在测试中均零真实提交
- 设计偏差：多角度保留600×308目标而不再用缩放压成491×252；快速切分按冻结合同使用modal大型sheet。CSS暂保留被后置新规则覆盖的旧局部选择器，R7审查时只在证明无影响后决定是否清理，不为样式整洁扩大当前阶段
- 阻断：无；首次m2失败是确定性测试locator歧义，已按最小范围修正并只复验m2
- 回滚点：R3启动提交`9346239657c1338759f7f1e761dc0c0549828abe`；产品提交`3cc7351`，安全fixture导入修正`39c98a8`，最终locator修正`1dd3fa5`
- 唯一下一动作：提交R3文档checkpoint；随后先把R4标为`IN_PROGRESS`，完成重绘、擦除、扩图、标注、裁剪回归和统一透明棋盘格大型舞台

## 15. R4 大型编辑器与透明舞台

- 时间：2026-08-24 03:46:02 +0800
- 阶段：`R4`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终被测`e01ee2f2749a9aa85c4c87bcbacd751713b5612e` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：R4产品和测试已分两次本地checkpoint提交；最终验证使用本Goal精确创建的detached临时worktree并已安全移除。当前只剩受保护JSON未跟踪且不在diff/stage；旧v0.6.32 receipt worktree同名改动mtime仍停在2026-08-23，当前无同范围测试进程
- 产品文件：`client/src/canvas/ImageNode.tsx`、`client/src/imageTools/ImageAnnotationEditor.tsx`、`client/src/styles.css`；裁剪、重绘、擦除、扩图和标注全部进入统一checkerboard `ImageToolSurface`，大型编辑层改为Host内screen-space网格；重绘/擦除分离顶部工具条、中央contain舞台和底部Prompt；扩图明确原图范围与新增棋盘格边界并允许控制区换行；标注改为紧凑图标工具条并把导出busy同步给Host
- 测试文件：`tests/m2-image-node.spec.ts`；在既有10个spec内加入大型编辑器overlay/stage/toolbar/prompt/status viewport bounds、共享surface tone和棋盘格computed-style断言，保留裁剪安全Blob、标注IME/撤销重做/导出、重绘mask坐标与fake任务payload既有证据
- 文档文件：本Checkpoint、验收矩阵、TASKS；CURRENT_STATE没有候选、GitHub、版本或生产事实变化，按纪律不改
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`，仍只允许R7通过后进入R8
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0；m2只使用临时fixture、动态loopback、fake capability/task和本地派生资产
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8。精确提交`4fd1ba1`首次safe m2为`9/10`、退出1，唯一失败是测试误把现有class当成不存在的testid，产品其余9项和大型编辑器行为通过；只修locator后最终`e01ee2f` safe m2 `10/10 PASS`、退出0，safe m18 `2/2 PASS`、退出0。一次错误命令使用不存在的`m18-font-size-inventory.spec.ts`在spec选择门以0个匹配退出1、未执行产品测试；随后用真实`m18-typography.spec.ts`通过。最终source/snapshot`2548fe1b…5566`、4173 listener `24c91e57…8244` unchanged；未运行m100或full
- 浏览器视口、zoom、素材与结果：m2隔离Playwright在1440×900验证扩图和擦除，在裁剪既有目标视口验证安全Blob/大型舞台，在1280×720验证标注工具/舞台/状态区，在重绘fixture验证mask舞台/Prompt/工具条全部不越viewport；四zoom和全屏透明素材留给R5，横竖方完整矩阵留给R6
- 架构与数据风险：仅重排UI壳层、透明预览背景和annotation busy可见状态；棋盘格只由CSS渲染，不进入canvas/export字节；Dispatcher、operation payload、mask坐标、Generation/Media/Canvas/Library/Provider、schema和安全Blob合同未改
- 设计偏差：重绘/擦除移除三个无业务动作的`1K/x1/PRO`伪按钮，保留真实工具、羽化、Prompt和提交；标注图标以中文aria-label和tooltip保留可访问名称。旧布局选择器继续由文件末尾R4规则覆盖，按R7冻结审查决定是否安全清理
- 阻断：无；首次m2失败是确定性测试定位器错误，已最小修正并只复验直接spec
- 回滚点：R4启动提交`d0b981cf957dddb5c170d9ff69beeb005b342b47`；产品/测试提交`4fd1ba1`，locator修正`e01ee2f`
- 唯一下一动作：提交R4文档checkpoint；随后先把R5标为`IN_PROGRESS`，完成全屏透明舞台及Escape、焦点循环/返回、IME、reduced-motion和四档zoom交互矩阵

## 16. R5 全屏与交互完整性

- 时间：2026-08-24 03:53:34 +0800
- 阶段：`R5`
- 状态：`AUTO_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终被测`c5b86f9668146d6db9cbfd30eb2faf50b3910468` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：R5产品和测试已提交；最终验证使用本Goal detached临时worktree并已安全移除。当前仅受保护JSON未跟踪且不进入diff/stage
- 产品文件：`client/src/styles.css`让产品内全屏dialog透出共享checkerboard Surface；`client/src/imageTools/ImageToolHost.tsx`在外点关闭时preventDefault，避免浏览器默认指针聚焦覆盖Host的触发按钮焦点返回
- 测试文件：`tests/m2-image-node.spec.ts`；全屏直接断言checkerboard、透明dialog、contain视口、Escape、Tab/Shift+Tab循环、焦点返回和reduced-motion，并在zoom 0.15/0.85/1.0/1.5逐档验证detail及关闭按钮screen-space bounds完全不变；cutout直接验证外点关闭和返回“浏览全部”按钮
- 文档文件：本Checkpoint、矩阵、TASKS；CURRENT_STATE仍无候选/GitHub/版本/生产事实变化
- package / schema / candidate：`0.6.35 / schema39 / 无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`，R7前不进入发布
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0；m2生成式控件不提交且请求数组为0
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8。`5ec1af5`首次safe m2 `9/10`、退出1，直接抓出外点默认指针行为覆盖触发焦点返回；`1c5bd98`修正Host后m2仍`9/10`、退出1，唯一失败是新四zoom测试结束未恢复1.0而影响同spec后续世界坐标断言；显式恢复后最终`c5b86f9` safe m2 `10/10 PASS`、退出0。source/snapshot`03febf86…75c8`、4173 listener unchanged；未重复m18/m100/full
- 浏览器视口、zoom、素材与结果：全屏在1280×720四zoom下screen UI几何逐字相等；结合R3三视口panel和R4大型编辑器bounds，IMGEDIT-022达到定向自动通过。全屏真实透明素材和横竖方逐项截图留给R6统一矩阵，不冒充已完成
- 架构与数据风险：只改共享Host关闭事件和全屏surface背景；未调用浏览器Fullscreen API，未改下载、图片字节、Canvas zoom、业务payload或外部链
- 设计偏差：无
- 阻断：无；两次失败均是定向测试发现的真实焦点问题或测试状态清理问题，均最小修正并只复验m2
- 回滚点：R5启动提交`919aa3d`；全屏/交互测试`5ec1af5`，外点焦点修正`1c5bd98`，zoom清理修正`c5b86f9`
- 唯一下一动作：提交R5文档checkpoint；随后先把R6标为`IN_PROGRESS`，按全部工具、三视口、四zoom、横竖方透明素材、busy/error/切换序列和零请求门执行逐项浏览器回归

## 17. R6 逐工具功能与回归验证

- 时间：2026-08-24 04:31:00 +0800
- 阶段：`R6`
- 状态：`AUTO_PASS / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终被测`5f48f62890e0bedd6f9d7939c9e2a8750f09ad81` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：最终产品树与R5精确`c5b86f9`相同；R6只增加Seedance busy直接浏览器断言和本地截图/边界/控制台/请求计数证据。受保护JSON继续未跟踪且未进入diff/stage；本Goal临时test worktree均已移除，动态50947服务已停止，fresh data目录已移入macOS废纸篓，可恢复
- 产品文件：无最终净变化。调试中曾以两个提交尝试保护活动工具和Portal事件，但确定性DOM诊断证明活动工具、Host和源节点均未消失，故两项未经证实的产品变更已完整撤销
- 测试文件：`tests/m2-image-node.spec.ts`；Seedance validation路由加入受控gate，直接证明busy按钮/关闭禁用、Escape和外点不关闭、放行后只提交一次并正常恢复。既有同spec继续证明横1280×720、竖180×320、1:1裁剪、四zoom、裁剪失败错误、IME、焦点、透明surface和零Generation/Provider
- 文档/证据文件：本Checkpoint、验收矩阵、TASKS、`spec/evidence/inc-imgedit-004-r6/`下13张PNG、README和`browser-receipt.json`；CURRENT_STATE仍无候选/GitHub/版本/生产事实变化，按纪律未改
- package / schema / candidate：`0.6.35 / schema39 / R7前无候选`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`，R7通过前未进入发布
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0。浏览器CDP对“关闭全屏→打开/关闭调整像素→打开/关闭快速切分”计数`Network.requestWillBeSent=0`、Generation/Provider命中0；隔离服务日志无Generation/Provider路由
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8。R6 busy证据调试的多个精确提交m2均`9/10`，最终DOM诊断记录`activeTool=seedance / hostCount=1 / panelCount=1 / selected=image-primary`，确认失败根因只是busy后按钮可访问名称已从“运行本地技术预检”变为“校验中…”，旧locator自然找不到元素；修正locator并撤销无关产品尝试后，精确`5f48f62` safe m2 `10/10 PASS`、退出0，source/snapshot`76461c61…bbfbf`、4173 listener unchanged。一次从主工作树误启动的命令在产品spec前被既有`backups/`负控以EISDIR停止，产品测试0、source/listener unchanged；未绕过runner或删除备份。最终产品树未改，复用R2 m100 `13/13`、R4 m18 `2/2`有效证据，未为安心重复
- 浏览器视口、zoom、素材与结果：动态loopback50947、fresh data、512×512真实Alpha PNG；保存1280×720工具栏/菜单、多角度、裁剪、重绘、扩图、擦除、标注、全屏，1440×900增强/调整像素/抠图/Seedance，1728×900快速切分共13张截图。每个活动工具均`hostCount=1/dialog=1`且bounds不越viewport；modal均root inert/aria-hidden，popover不误设inert。全屏surface为1248×688，透明棋盘格清晰；重绘/擦除/扩图/标注大型层均1118×686；多角度600×308；更多菜单238×272。控制台error0/warn0；启动时为修正最初漏建fresh data目录而发生1条预期Vite重连日志，已在receipt中单列，不冒充产品错误
- 架构与数据风险：R6没有最终产品、业务payload、Generation/Media/Canvas/Library/Provider或schema变化；棋盘格仍只由CSS呈现，不改上传/导出字节。自动、隔离浏览器、生产和用户验收继续分层
- 设计偏差：首次手工Alpha PNG由普通上传产生，没有`imageToolOutputBackground=transparent`业务标记，因此不把该节点卡截图冒充生产抠图节点证据；节点透明输出class由m2直接覆盖，编辑器/全屏真实Alpha棋盘格由本轮截图直接覆盖，生产既有抠图节点留到R9零付费复验
- 阻断：无
- 回滚点：R5文档提交`fb8f583`和R6启动提交`8795b13`；R6最终产品树保持R5，测试收口提交`5f48f62`
- 唯一下一动作：提交R6文档与证据checkpoint；把R7标为`IN_PROGRESS`，冻结候选并执行独立只读代码/UI/可访问性审查、候选静态门和唯一一次safe full

## 18. R7 候选冻结与独立审查

- 时间：2026-08-24 05:25:39 +0800
- 阶段：`R7`
- 状态：`AUTO_PASS / LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / VIEWPORT_MATRIX_PASS / LOCAL_BROWSER_PASS / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / 最终本地候选`161f417e401e6ad332a756510fc6e4c59136b972` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：独立只读审查后的产品/测试修正冻结为`39cd494`，R7治理候选为`4fd25cc`；唯一一次safe full在本Goal专用detached worktree`/private/tmp/unboundry-inc004-r7-full-6x38Xs`执行。两个失败分别以`e2c412e`和`161f417`修正测试确定性/合法前置条件后只复验最小失败spec。主工作树仍只有受保护JSON未跟踪且不进入diff/stage；4173用户既有listener未触碰
- 独立审查：独立审查者只读检查代码/UI/无障碍与R6证据，报告5项候选阻断：普通透明上传节点缺棋盘格、标注图标缺实际tooltip、busy后焦点可能停在disabled按钮、URL-only旧节点可打开空裁剪Host、四档zoom只对全屏有直接证据。另确认没有P0、viewport溢出、重复Host、Provider/OSS或数据合同问题
- 产品文件：`client/src/canvas/ImageNode.tsx`让所有有图片预览的节点使用共享CSS棋盘格surface，并对缺少持久assetId的裁剪入口显示原因并fail-closed；`client/src/imageTools/ImageToolHost.tsx`在busy切换后把失效焦点收回panel并让Tab/Shift+Tab从panel继续循环；`client/src/styles.css`补标注hover/focus-visible tooltip。没有新增fetch、Provider、轮询、上传、schema或业务payload变化
- 测试文件：`tests/m2-image-node.spec.ts`直接断言普通上传节点surface、URL-only裁剪禁用原因、标注伪元素tooltip、Seedance busy焦点/Tab/Shift+Tab/Escape，以及裁剪、多角度、重绘、擦除、扩图、标注、增强、调整像素、抠图、快速切分、Seedance和全屏全部12工具在`0.15/0.85/1.0/1.5`下screen-space尺寸不变并保持viewport内
- 文档文件：本Checkpoint、验收矩阵、TASKS和CURRENT_STATE候选事实；如实保留原始full的两个失败，不把定向修正复验改写成full全绿
- package / schema / candidate：`0.6.35 / schema39 / 最终本地候选161f417 / SAFE_FULL_EXECUTED_WITH_TARGETED_CORRECTION_RECHECKS`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`；R7收口后进入R8，但不得移动同名不可变tag或覆盖既有release，必须先做身份预检
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0；定向测试和full只使用fresh临时数据、动态loopback与fake能力
- 测试命令、环境、结果、退出码：Node22.23.1/npm10.9.8。精确`39cd494`上safe m2 `10/10 PASS`、m18 `2/2 PASS`、m100 `13/13 PASS`，source/snapshot均`8c3cd1a6…f5b98`。精确`4fd25cc`执行本Goal唯一一次`node scripts/run-safe-tests.mjs full`：120 specs / 1052 tests，`1050 passed / 2 failed`，skipped/retries/blocked/reportErrors均0，source/snapshot`ce6403b6136452263550846c2bdc1515fdba3abf0146b83f8d2ef6c8c41a8414`，退出1；失败为m24在异步目录结果返回前读取计数，以及m37在modal inert后仍试图强改背景标题来制造裁剪持久化丢失前置条件。未重复full。m24改为确定性等待后在精确`e2c412e`复验`2/2 PASS`、退出0；m37改为直接驱动真实`createDerivedImageToolUseCase`、临时Media API与`createCanvasGraphCommandPort`，在真实上传后/graph adoption前关闭持久层并验证DELETE/404、无派生节点、Provider计数不变，精确`161f417`复验`35/35 PASS`、退出0，source/snapshot`cfd831bc023a64cc967be31c3de16227844f876f4d73871cd1937b3cc182f3d6`。各轮4173 listener unchanged；safe入口附带TypeScript、生产build、架构76个既有例外/新增0、source coverage、凭据和网络门均通过
- 浏览器视口、zoom、素材与结果：复用R6三视口13张截图和真实Alpha浏览器证据；R7 m2新增全部12工具四zoom直接几何断言，补齐R6 receipt只在各工具单一zoom截图的证据边界。定向测试没有真实生成提交
- 架构与数据风险：棋盘格只画在节点CSS surface，图片字节和导出不变；assetId缺失的历史URL节点不再进入空modal，已完成安全持久化后裁剪照常启用；Host仍只管理显示层/焦点/关闭，不接业务编排
- 设计偏差：为覆盖无法在ImageNode内安全探测跨域Alpha且禁止新增fetch的合同，所有已加载图片节点都使用棋盘格底层surface；不透明像素继续覆盖surface，透明/contain留白可明确辨认。这是共享surface实现，不是输出字节处理
- 阻断：R7无阻断；唯一一次full已执行，两个失败均已保留原始事实并由最小定向修正复验关闭。R8仍需核对同名不可变tag/release身份，不在R7预先作发布结论
- 回滚点：R6文档提交`128e3cff84d0e700c1197139fcdc4126916993ff`；R7产品修正`39cd4945e847504733e425abc3a3a16e8489906c`；full前治理候选`4fd25ccb49b98573ab2e2ce8a6f28798f2ea3968`；最终定向修正候选`161f417e401e6ad332a756510fc6e4c59136b972`
- 唯一下一动作：提交R7最终治理证据；随后先把R8标为`IN_PROGRESS`，只读核对`v0.6.35`现有tag、GitHub release、main tree与生产release身份，确认是否存在不移动tag、不覆盖release且能绑定本候选的合法发布路径

## 19. R8 GitHub 与生产发布

- 时间：2026-08-24 05:27:46 +0800
- 阶段：`R8`
- 状态：`IN_PROGRESS / GATES_VALID / IMMUTABLE_IDENTITY_PREFLIGHT`
- branch / HEAD / origin-main：`codex/inc-imgedit-004-ui-remediation-docs-2026-08-24` / `323088f261f5c3ad6839865e0986fec3ce794581` / `f369d1dba1eef05aebc7f1a443256ceb82778ea0`
- 工作树摘要：R7治理证据已提交；主工作树只剩受保护JSON未跟踪且不进入diff/stage。尚未push、PR、merge、tag、SSH或改生产
- package / schema / candidate：`0.6.35 / schema39 / 本地R7候选323088f`
- 版本门 / 发布门：`v0.6.35 / VERSION_GATE_VALID`；“v0.6.35上线” / `RELEASE_GATE_VALID`
- Provider / OSS / 费用：真实Provider请求、尝试、成功0；费用0；真实OSS写入0
- 风险：文档记录`v0.6.35`已是现网不可变版本，现有tag/release可能绑定INC-IMGEDIT-003的不同源码；Runbook禁止移动tag或覆盖release。本阶段必须先核对身份，不能因两项门有效就破坏不可变发布合同
- 阻断：预检尚未完成，暂不下结论
- 回滚点：R7最终治理提交`323088f261f5c3ad6839865e0986fec3ce794581`
- 唯一下一动作：只读核对`v0.6.35`本地/远端tag、GitHub release、origin/main tree与生产release身份，再按真实结果决定合法发布或落档阻断
