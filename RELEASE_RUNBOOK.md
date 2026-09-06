# Unboundry 版本发布 Runbook

更新日期：2026-09-06。当前授权与进度只看 [TASKS](TASKS.md)，产品现状看 [CURRENT_STATE](spec/UNBOUNDRY_CURRENT_STATE.md)。以下普通代码/构建发布流程与独立文档同步流程分别适用。

## 1. 识别范围和已有授权

- 先核对实际Git root、branch、HEAD、dirty范围、origin及live current指针、版本/schema；外层资料目录和历史app路径不能替代真实源码树。
- 版本与发布授权须明确。用户已明确委托自行增加patch时直接核对未占用版本，不再次索要版本确认。其他情况下按`上线规矩.md`补齐缺失范围。
- 发布授权不自动包含付费生成、历史数据/备份删除、schema迁移或云权限变更；已有明确授权则在原范围内继续，不重复确认。
- 两份永久保护JSON不得读取、hash、复制、移动、修改、删除或暂存：`spec/public-templates-director-split-revision.json`、`spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`。所有源码导出/检查使用显式排除。
- 纯模板数据发布走`上线规矩.md`轻量路径；纯文档同步按下节发布独立文档镜像，不替换产品构建或 bump 产品版本。

## 独立文档同步

1. 用户授权推送和同步后，将治理入口及其现行文档依赖提交到 GitHub；保留产品代码与数据。PR 最终 head 和合并后的 main 均通过现有 CI，其中 m38 检查治理入口。
2. 从通过 CI 的精确 main 提交枚举并导出已跟踪 Markdown、文档索引/回执、治理测试与 CI 配置；先按路径排除两份永久保护 JSON。不要复制 dirty 工作树、凭据、真实数据、依赖或本地日志。
3. 在服务器 `/opt/unboundry/governance/releases/<文档提交SHA>` 新目录准备私有镜像；生成 `.governance-manifest.json`，记录提交、文件清单和 SHA-256。校验完整后原子切换 `governance/current`；保留上一镜像用于文档回退。
4. `/opt/unboundry/AGENTS.md` 使用 [服务器导航源](ops/production/GOVERNANCE_AGENT_ENTRY.md)，进入当前镜像。镜像不进 Nginx/应用静态目录，不提供公网文档页；不改 `/opt/unboundry/current`、产品 release、数据库或服务。
5. 比较 Git 提交、本地对应文件及服务器镜像哈希；核对产品版本、current、PID/restarts 前后不变。这里的健康检查只证明文档同步没有改变进程状态，不替代产品行为验收。收尾文档有新提交时再同步该提交并核验；不因此重启产品或触发付费生成。

## 2. 本地候选和最小必要验证

1. package/lock与`server/bridgeRuntimeMode.ts`精确版本准入一致；不要移动既有tag，普通版本不加hotfix。
2. 列出实际行为变更、直接依赖和失败代价，选择受影响safe specs；用本轮合成数据和动态loopback，不碰4173、本地app/data、真实Provider或OSS。
3. 普通类型/构建默认Node25.9.0/npm11.12.1；safe runner和source coverage专用Node22.23.1/npm10.9.8；生产Node22.23.2/npm10.9.8，不能混同。
4. 成功测试只在相关代码变化、明确失败或强制发布门时重跑。文档更新只检查文档，不重跑业务full。风险跨域且发布门确需full时按当次计划执行，不能继承或复活旧Goal的full权限。
5. 冻结产品候选并审查实际增量；区分主代理审查与独立审查。UI变化先让用户验收可见本地候选；通过后复核候选未漂移。
6. 新增持久字段须验证旧节点读取、旧客户端命令、刷新、撤销、并发与回退包兼容。schema号未变并不证明旧包可读新字段。

## 3. GitHub和不可变身份

获当次发布授权后，显式文件清单commit/push → PR的最终head CI通过 → 合并 → main CI通过 → annotated tag指向精确merge → GitHub Release。

当前CI源码为`.github/workflows/quality-gates.yml`：macOS15；Node25类型/架构/build、`npm audit --audit-level=high`；随后Node22 safe preflight、ffprobe准备、m104真实HTTP/fake Provider集成、源码覆盖及其行为检查。中等级告警不会使high阈值失败，CI绿色不等于依赖无告警或真实付费验收通过。

记录PR、branch/main CI run、tag object、peeled commit/tree和Release。已发布tag和产品构建不可改写；后续验收文档记录用自己的提交身份，不将文档HEAD冒充生产产品commit。

## 4. 从精确tag构建新目录

- 从已通过main CI的精确tag，用排除受保护路径的allowlist导出源码，落到全新staging目录；不上传脏工作树或复用旧dist。
- 在该目录按lock安装并用自身源码构建，核对Node/npm、源码清单不变、构建完整性。v0.7.14记录为921源码文件与33静态资源；这些是该次分母，下次须重新枚举。
- 使用NUL分隔文件名制作清单，排除清单自身和永久保护路径；校验源码身份和完整静态资产，不能只看一个JS文件。
- `scripts/deploy.mjs`已立即抛`LEGACY_DEPLOY_DISABLED`，不得执行旧rsync一键上线流程。
- `scripts/build-release.mjs`、`lib/release-source-pair.mjs`及配对演练工具绑定历史0.5.2/0.6.0合同，不是任意patch发布器；不要为了新版本改写历史工具。

## 5. 当前schema43备份门

当前使用不可变release内`backup-data.mjs` → `verify-backup.mjs` → `restore-backup.mjs`合同。正式切换前最新快照须持有真实冻结/静默证据并满足locked-exact：显式schema43、logical SHA、冻结时间、last Provider admission、独立scratch、外置签名/恢复key路径及精确媒体策略。

必须先核对当前活动任务、计费结果不明边界和publication，不伪造冻结时间或为通过门清理历史终态记录。备份不通过就不切换。`--external-freeze-non-final`不能冒充final candidate；schema42仅历史恢复，不能作为当前验收schema。

- 私钥内容不得输出或进仓库；新恢复目录私有且独立，不能覆盖CURRENT。
- verify通过后fresh restore，再核对schema43、integrity、FK、logical SHA及计数/媒体/secret清单。日志模式包含实际生产DELETE，不能只测WAL。
- 允许的历史媒体warning精确列入证据，不能写成“无媒体问题”；v0.7.14保留98条非阻断提示。
- 真实云上传只在已授权范围进行，上传后需要GET哈希/大小核验，PUT成功本身不等于可恢复。
- `ops/production/backup-to-oss-retention.mjs`可创建当前加密备份并上传；它自身不自动完成verify/fresh restore/远端GET闭环，需要操作方案分别补齐。
- **当前自动备份故障尚未修好**：systemd仍调用`/opt/unboundry/scripts/backup-to-oss.mjs`，其旧子脚本要求schema41。不得把它作为当前备份入口。更不能仅因应用已升级就宣称每日备份生效。

## 6. 切换与回退

先准备本次精确新包、精确兼容回退包及数据保持策略，在隔离副本完成真实Linux HTTP保存/刷新和forward→rollback→forward；记录其与真实systemd切换测试的区别。正式维护中保留旧current身份，排空再原子切换；核对服务、版本、ready、数据及静态资源后解除维护。

v0.7.14具体回退约束：

- 新包：`/opt/unboundry/releases/v0.7.14-media-aspect-20260906`。
- 兼容包：`/opt/unboundry/releases/v0.7.14-compat.1-media-aspect-20260906`。
- 已备脚本：`/var/lib/unboundry-v0714-media-aspect-20260906/evidence/rollback.py`；执行前仍须核对当次授权与脚本身份，不因本Runbook而运行。
- 兼容包保留新字段解析和manual保护，只关闭新auto适配/主动按钮/临时置前；使用不同版本标识，保留CURRENT全部新数据。
- **禁止直接切旧v0.7.13**：旧parser/resize语义与新字段不兼容。v0.7.11检查点仅为代码恢复基线，也不等于当前数据库可直接降级。
- v0.7.14已完成隔离Linux配对运行与两个包的DELETE写入验证；没有执行真实线上systemd回退演练，不补造该PASS。

## 7. 发布后验证

1. current精确指针、`/api/version`、`/api/health/live`与`ready`、service/PID/restarts、schema与当前数据保持；ready只证明进程/只读探针。
2. 首页引用与其他静态资产全部在公网和loopback逐项匹配构建清单。
3. 用既有素材或已授权合成上传核对实际受影响界面，观察保存/刷新/重新打开与写请求次数；查看和刷新不得产生额外Canvas写或Generation POST。
4. 真实生成仅在单独明确授权后进行，不能照抄v0.7.7旧group点击；结果不明不自动重复提交。
5. 更新提示须单独记录：v0.7.14维护期间旧EventSource遇502未恢复，人工刷新通过。不要把m82正常SSE测试当故障重连验收。

## 8. 收尾

生产回执分别记录源码/CI、定向或full范围、备份/恢复/云端验证、生产数据和UI、未决风险、用户验收。先是技术结果，只有用户明确通过才记对应范围USER_PASS。

更新CURRENT_STATE、TASKS、主题checkpoint、总矩阵及必要架构/操作文档。固定历史JSON、失败记录和tag不改写；演进中的当前回执补上后续验收事实。文档是否commit/push按用户当次授权，不能把旧发布授权扩为永久权限。

仅清理当次已获授权且确认身份的临时副本；保留用户数据与必要回退/恢复材料。不要为了收尾再部署、重复测试、真实生成或清空历史未决项。
