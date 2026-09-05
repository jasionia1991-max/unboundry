> **2026-09-06 v0.7.13 发布授权已确认，准备中。** 用户明确确认按 v0.7.13 发布 DELETE journal 保存补修；包含 commit/push/PR/CI/tag/Release、最新备份与独立恢复、生产切换和零付费验收。当前生产仍 v0.7.11/schema43；保留 v0.7.11 恢复检查点和 CURRENT 数据，不迁移、不触发付费生成。补修最终直接29/29及 Linux 禁网 DELETE 写入通过，上传/清单40项复用；新版本 m81 42/42、文档标记纠正后 m38 19/19通过，首次60/61保留；不宣称全量1266通过。v0.7.12验收失败记录与不可变发布物保留；自动备份仍未修复，本次使用手动验证备份。唯一断点见 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`。下方旧状态只作历史。

> **2026-09-06 05:28 CST 当前状态：v0.7.12 零付费生产验收失败，已保留 CURRENT 数据回退至 v0.7.11/schema43。** 上传201后 Canvas commands 500，已在 Linux 禁网恢复副本实证 DELETE rollback journal 被新 WAL 检查误拒。当前补修仅在本地分支 `codex/performance-delete-journal-save-fix`，未 commit/push/发布；最终直接29/29、既有上传/清单40项复用、独立复核GO，不能写全量1266通过或线上性能修复完成。v0.7.12 tag/发布物不可变且已标失败，v0.7.11恢复分支39c6385不变；下一版须重新确认版本号和允许发布。自动备份timer仍失败，最新手动加密备份verify/fresh restore通过，996文件及清单OSS上传/GET校验于05:48 CST通过。唯一断点为 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`，详细回执为 `spec/V0_7_12_FAILED_ACCEPTANCE_ROLLBACK_AND_LOCAL_CORRECTION_2026-09-06.json`。以下更早状态均为历史。

> **2026-09-06 v0.7.12 发布当前状态**：用户已先确认上线/回退方案，再明确同意按 v0.7.12 发布；本次授权包含候选提交、PR/CI、不可移动标签/Release、最新备份与独立恢复验证、生产切换及零付费验收。保留 v0.7.11 恢复分支和当前数据；不触发真实付费生成，不删除历史备份/素材，不迁移schema43。生产运行`v0.7.11/schema43`，当前断点 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`。20产品文件已审证据复用，新增仅版本登记及必要发布增量，版本定向验证待执行。自动备份旧入口缺少动态冻结证据，保持安装NO_GO；最新手动备份独立作为应用发布前置门。下面未授权/待版本确认是历史时点。

> 2026-09-06 当前本地工作已转入 `spec/PERFORMANCE_REMEDIATION_CHECKPOINT_2026-09-06.md`。下面发布记录是历史事实；本轮仅本地性能修复，不授权线上/付费操作。

# Production backup contracts

This directory contains production operation sources. Production currently runs
`v0.7.7/schema42`; PR #155, branch/main Quality, immutable tag/Release,
exact-tag build, locked-exact backup/restore, switch and rollback-forward all
passed. The v0.7.7 release authorization is consumed. Its ordered post-deploy
refresh gate did not pass: the server Canvas produced four redundant successful
PUTs that changed only three image-card heights. There was no 409, false task
read warning or generation submission during refresh, but the required zero-save
condition failed, so group `group-17ee0cbc-cc81-4b35-9c5e-41040f627033` was not
clicked and no real workflow was executed. The root cause is the image preview
hydration path rewriting persisted style dimensions after load. There is no
authorized next-version candidate; code repair, release and real execution need
new authorization. Current evidence is recorded in
`spec/V0_7_7_PRODUCTION_RECEIPT_2026-09-03.json`; candidate and v0.7.6 receipts
are historical evidence only.

## Local candidate schema42/schema43 backup contract

`backup-to-oss-retention.mjs` calls the signed, encrypted
`scripts/backup-data.mjs` contract. It requires explicit absolute source,
backup, scratch, key, profile, schema, logical-SHA, freeze, and last-admission
arguments. Schema must be explicitly 42 (historical recovery) or 43 (current-schema final candidate). With no `--apply-upload` it creates only
the local encrypted package and prints a dry-run inventory; it performs no OSS
write. `--apply-upload` is a separate production side effect and is not
authorized by this repository state. Retention deletion remains fail-closed
even with upload apply until an exact remote deletion manifest and a separate
reviewed operation exist.

The wrapper must remain at `ops/production/backup-to-oss-retention.mjs` inside
the complete immutable release tree; do not copy it into a standalone system
path. It resolves `scripts/backup-data.mjs` and
`server/secureStorageProfiles.ts` from that immutable module location and sets
the child WorkingDirectory to the same release root. The systemd unit may set
`WorkingDirectory` for readability, but correctness must not depend on it.
Unknown, missing, or duplicated options fail before a backup package or OSS
client can be created.

Before any future installation, freeze an immutable release and record:

- release commit/tree and wrapper SHA-256;
- installed absolute paths and owner/mode;
- exact selected-schema database logical SHA and freeze evidence;
- signing trust anchor and recovery-key identities, never private key bytes;
- systemd service/timer unit hashes and the next scheduled time;
- backup, verify, fresh-restore, fake-OSS, and zero-egress receipts.

The consumed v0.7.7 release authorization and failed refresh gate are recorded
in the INC-GEN-026 Checkpoint. Every future release switch, timer installation,
and real OSS upload/delete/restore still requires separate user authorization.

## Historical schema39 artifact

`backup-data-schema39.mjs` is retained only to identify the 2026-08-15 legacy
plaintext format. It now exits immediately with
`HISTORICAL_SCHEMA39_BACKUP_DISABLED` and must not be installed as the current
timer source. Historical hashes and receipts remain historical evidence; they
do not authorize reuse against schema42.

The two protected JSON files named in `AGENTS.md` remain outside every backup
source, test snapshot, release inventory, and Git operation.
