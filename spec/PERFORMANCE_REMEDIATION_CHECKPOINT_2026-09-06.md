> **2026-09-06 当前：v0.7.13 已上线，零付费功能验收通过，性能仅部分达标。** 生产运行`v0.7.13/schema43`，commit `66f16304a6f9aefeda04cbb5eee09317ba0abd6e`、PID668342；PR162双CI通过（主分支首轮进程清理EPERM保留，原提交重跑成功）、exact-tag构建911源码一致。最新冻结备份verify/fresh restore及997文件和清单云端上传/GET核对通过；本次临时副本已清理3,939,555,876字节，剩余98,019,000,320字节。真实上传201、Canvas保存200、刷新/重新打开零额外写且内容保留、本地blob先显、模板摘要惰性通过；暖画布182ms/能力208ms，但历史27小图冷加载11.682s、首次新建1.214s，不能标性能全通过或USER_PASS。真实生成0，任务1086/attempt1097不变；CURRENT未覆盖，schema未改，v0.7.11恢复点39c6385不动。自动备份服务仍failed；本次手动备份通过，历史媒体97项非阻断提示保留。唯一断点为 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`，生产回执 `spec/V0_7_13_PRODUCTION_RECEIPT_2026-09-06.json`；以下更早时点均为历史。

> **2026-09-06 v0.7.13 发布授权已确认，准备中。** 用户明确确认按 v0.7.13 发布 DELETE journal 保存补修；包含 commit/push/PR/CI/tag/Release、最新备份与独立恢复、生产切换和零付费验收。当前生产仍 v0.7.11/schema43；保留 v0.7.11 恢复检查点和 CURRENT 数据，不迁移、不触发付费生成。补修最终直接29/29及 Linux 禁网 DELETE 写入通过，上传/清单40项复用；新版本 m81 42/42、文档标记纠正后 m38 19/19通过，首次60/61保留；不宣称全量1266通过。v0.7.12验收失败记录与不可变发布物保留；自动备份仍未修复，本次使用手动验证备份。唯一断点见 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`。下方旧状态只作历史。

> **2026-09-06 05:28 CST 当前状态：v0.7.12 零付费生产验收失败，已保留 CURRENT 数据回退至 v0.7.11/schema43。** 上传201后 Canvas commands 500，已在 Linux 禁网恢复副本实证 DELETE rollback journal 被新 WAL 检查误拒。当前补修仅在本地分支 `codex/performance-delete-journal-save-fix`，未 commit/push/发布；最终直接29/29、既有上传/清单40项复用、独立复核GO，不能写全量1266通过或线上性能修复完成。v0.7.12 tag/发布物不可变且已标失败，v0.7.11恢复分支39c6385不变；下一版须重新确认版本号和允许发布。自动备份timer仍失败，最新手动加密备份verify/fresh restore通过，996文件及清单OSS上传/GET校验于05:48 CST通过。唯一断点为 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`，详细回执为 `spec/V0_7_12_FAILED_ACCEPTANCE_ROLLBACK_AND_LOCAL_CORRECTION_2026-09-06.json`。以下更早状态均为历史。

> v0.7.12 版本增量独立审查 GO，m81+m38 61/61 PASS；前两次日志输出权限导致的基础设施启动失败保留，不计为业务运行。20产品文件哈希未变，不重复formal full。当前进入提交/PR/CI，生产仍0711，备份/切换门待完成。详见 `spec/V0_7_12_RELEASE_CANDIDATE_RECEIPT_2026-09-06.json`。

> **2026-09-06 v0.7.12 发布当前状态**：用户已先确认上线/回退方案，再明确同意按 v0.7.12 发布；本次授权包含候选提交、PR/CI、不可移动标签/Release、最新备份与独立恢复验证、生产切换及零付费验收。保留 v0.7.11 恢复分支和当前数据；不触发真实付费生成，不删除历史备份/素材，不迁移schema43。生产运行`v0.7.11/schema43`，当前断点 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`。20产品文件已审证据复用，新增仅版本登记及必要发布增量，版本定向验证待执行。自动备份旧入口缺少动态冻结证据，保持安装NO_GO；最新手动备份独立作为应用发布前置门。下面未授权/待版本确认是历史时点。

# 性能修复唯一当前断点

> 2026-09-06 上线方案确认后的最新状态：用户已回复“确认”，上线/回退方案已获同意；仓库 `上线规矩.md:60-70` 仍要求明确版本号，尚未指定，当前为 `PLAN_CONFIRMED / RELEASE_VERSION_PENDING`。只读生产核对仍为 v0.7.11、commit7af5fca、Node22.23.2、active/running、PID558375、NRestarts0；磁盘16%、可用96G。远端v0.7.12尚未占用；20产品文件与已审回执哈希全部相同，恢复分支39c6385未变，不重跑成功业务测试。备份unit仍调用旧独立脚本 `/opt/unboundry/scripts/backup-to-oss.mjs`，无ExecStartPre与当前freeze/SHA参数，服务exit1；仅换路径不足以修好，自动作业入口仍待实现验证。未commit/push/tag/修改线上/付费生成。回执：`/Users/mymy/Documents/unboundry/performance-local-evidence-20260906/release-preflight-20260906.json`。以下“用户未确认”的段落为此前时点，不覆盖本更新。

状态：LOCAL_IMPLEMENTATION_COMPLETE / LOCAL_REVIEW_GO / RELEASE_NO_GO / USER_RECHECK。

用户于 2026-09-06 授权按已审查方案完成本地实施、必要测试和审查，最后提交验证结果与具体上线/回退方案；不修改线上、不触发真实付费生成。未启动 Goal，未授权发布或复用旧点击预算。

- 工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`
- 实施分支：`codex/performance-remediation-from-v0.7.11`
- 不动的恢复分支：`codex/restore-v0.7.11-before-performance-20260906`
- 基线检查点：`39c6385427d3f62d1e4f8231046bb5159ee55ecd`，源码树与发布 `v0.7.11` / `7af5fcab8123c32a487a7d0119b3517b5dd71574` 相同。
- 权威方案：`/Users/mymy/Documents/unboundry/PERFORMANCE_REMEDIATION_PLAN_AND_REVIEW_2026-09-06.md`；诊断与数据库打开路径清单在相同目录。
- 线上最后一次已验证版本为 v0.7.11/schema43；本轮不做新的生产操作。package 暂不升级，后续发布版本未分配。
- 永久受保护 JSON 两份禁止读取/哈希/改动；仅使用安全 runner、临时合成数据和动态 loopback。

## 工作包

| 包 | 状态 | 当前证据 |
| --- | --- | --- |
| A 基线与观测 | LOCAL_MEASURED / ONLINE_PENDING | 合成约50MiB，20次能力样本；built空画布20次；不冒充线上性能 |
| B1 只读热点 | IMPLEMENTED / TARGET_PASS | 能力/模型/输入/空恢复扫描只读，维护/schema/inode拒绝不减弱 |
| B2 写入热点 | IMPLEMENTED / TARGET_PASS | 受控同步事务；异常回滚、外部提交/崩溃/替换测试通过 |
| C 逐节点同步 | IMPLEMENTED / TARGET_PASS | 浏览器首节点先出现、后续仍运行，用户编辑和刷新保留，零额外生成；补充Ctrl+Z/Redo保留结果通过 |
| D 上传临时预览 | IMPLEMENTED / TARGET_PASS | blob先显、不持久化；lost ACK已接管资产不误删 |
| E 历史小图 | IMPLEMENTED / TARGET_PASS | 真实PNG编码、权限撤回、LRU/单飞/冷却；20图本地冷664ms/暖0.56ms、490KiB通过（不含OSS/浏览器） |
| F 启动精简 | IMPLEMENTED / TARGET_PASS | 模板摘要惰性、单图版本检查；built冷首909ms、暖19次P95875ms，loopback样本 |
| G 审查与发布准备 | LOCAL_COMPLETE / RELEASE_NO_GO | schema43本地恢复通过；独立P2关闭，产品审查0未关闭；formal1258/1263+60/60关闭；具体发布回退材料待用户确认 |

## 验证账本

统一命令 `node scripts/run-safe-tests.mjs run --spec ...`，安全 Node22.23.1/npm10.9.8、新临时数据/动态loopback/fake Provider/OSS；真实外联为零。日志在 `/Users/mymy/Documents/unboundry/performance-local-evidence-20260906/`。

- `cdef-safe-attempt4.log`：25/25，0 fail/skip/retry/blocked/reportErrors。其后相关改动以更新证据为准。
- `browser-performance-attempt3.log`：104/106，2失败（新增schema43包装参数、逐节点fixture独立节点并发冲突）；失败记录保留。
- `recovery-performance-attempt1.log`：46/48，schema43备份19/19通过；2失败分别为编辑测试未进入编辑态、测试hook误把只读reservation判作writer，已按真实合同修正。
- `closure-performance-attempt1/2.log`：源覆盖摘要过期，业务0运行，不冒充产品失败或PASS。
- `closure-performance-attempt3.log`：62/62，5specs（m104可靠性15、m107性能14、m2图片15、m71模板14、m79正式构建4）；0 fail/skip/retry/blocked/reportErrors，源码快照 `81cec80d132cc74fd4981dcb7c18f9637779e6d7e55471b14570e211f4b771ef`。
- `final-boundary-attempt1.log`：29/29，补Ctrl+Z/Redo及20图批量真实codec冷暖，异常0。
- `final-full-attempt1.log`：唯一正式full，128specs/1263tests，1258PASS/5FAIL，exit1，0skip/retry/blocked/reportErrors；源码9fda5f60dddf8caa0a8a7bed167d116f5843d9c2c6f30beb72b998cce0ffb36a。五失败为m105新入口未分类、m3-history旧原图断言、m37两项image失败即删旧断言、m38版本文档；原失败永久保留。
- `post-full-closure-attempt1.log`：上述4文件60/60，exit0，异常0；源码12bb660b63a33cb8ebadbdb164a2fa973eac83b9d487b5a768c7a141aee06ab9；只改分类/测试/文档，20产品文件未变，不重复full。
- 独立产品审查20文件/116hunks，1个同key旧run P2已修并独立复核；未关闭P0/P1/P2=0/0/0。后full文档/清单/测试增量独立复核GO，仅限本地候选；未放宽未知writer、未把小图当原图、未恢复不确定删除。

## 结论边界与下一步

已授权的本地产品实施与必要验证完成，发布和生产前置门待用户确认。不得以本地测试代替Linux生产/真实OSS/真实付费生成或主观USER_PASS。32项风险逐条处置/证据边界已写入外部PERFORMANCE_RISK_CLOSURE；未实测的线上网络/真实付费/Safari等不标通过。

发布与回退确认材料：`/Users/mymy/Documents/unboundry/PERFORMANCE_LOCAL_VALIDATION_AND_RELEASE_PLAN_2026-09-06.md`；数据库32文件复核：同目录 `PERFORMANCE_DATABASE_OPEN_CLASSIFICATION_2026-09-06.md`。当前 RELEASE_NO_GO（用户未批准发布），恢复检查点不变。

当前下一步：仅提交本地验证和上线/回退方案供用户确认；不创建Goal，不commit/push/tag/部署、不真实生成。原恢复分支39c6385/tree3887f669再次核对不变。所有测试快照已清理。
