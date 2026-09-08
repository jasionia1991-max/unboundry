# Production backup contracts

Current snapshot: 2026-09-07, `v0.7.16/schema43`. Product state, release identity and exact backup results are owned by [current authority](../../spec/UNBOUNDRY_CURRENT_STATE.md) and the [v0.7.16 release receipt](../../spec/V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json). The presence of operation sources in a release does not mean the systemd timer uses them.

## Observed production state

- The application was switched to the exact v0.7.16 package; actual pointer, PID, restart count and verification are in the release receipt rather than duplicated here.
- Daily backup failure remains `USER_DEFERRED`: installed ExecStart still uses `/opt/unboundry/scripts/backup-to-oss.mjs` and its old schema41 validation. The application is schema43; this release did not alter that job.
- The new manual frozen schema43 backup, verify and independent fresh restore passed. Cloud upload/GET completion and all counts are owned by the current release receipt. The 98 pre-existing nonblocking media warnings remain; a manual backup does not repair or validate the daily timer.

The daily job needs a separately implemented and verified current-schema freeze/backup/restore/upload pipeline and an exact installed-unit receipt. Replacing only a path or schema constant does not provide dynamic freeze and logical-SHA evidence.

## Current wrapper contract

`backup-to-oss-retention.mjs` resolves `scripts/backup-data.mjs` and `server/secureStorageProfiles.ts` from its own immutable release root. Keep it in `ops/production/` within the complete release; do not copy it to a standalone `/opt/unboundry/scripts` path.

Required arguments explicitly identify source, backup root, scratch root, signing-private-key and recovery-public-key paths, storage profile, schema, database logical SHA, generation freeze and last Provider admission. Schema43 is current/final; schema42 is historical recovery. Unknown/missing/duplicate arguments fail closed. Media warnings and OSS mirrors are explicit repeatable arguments.

Without `--apply-upload`, it creates a local encrypted package and reports an upload inventory; this is not a zero-write dry-run of the local filesystem. It reads the selected source's encrypted storage profile, never an inherited unrelated data directory. With upload authorization, `--apply-upload` writes private no-overwrite objects and a manifest. The wrapper does not itself run separate verify/fresh-restore or GET content verification; the operation must supply these gates. Retention deletion is blocked pending an exact reviewed remote deletion manifest; this is not an active automatic deletion policy.

## Authorized stopped preservation capture

A separately authorized release may use `quiesced-active-preservation` under [Runbook 5.1](../../RELEASE_RUNBOOK.md#51-经当次授权的停服保全备份). It must preserve exact task/attempt/event evidence and hold the existing runtime lease, secret lease and SQLite capture lock after verified shutdown. This is a distinct signed mode; it does not loosen `locked-exact`, turn an unknown task into a terminal task, or make `external-unverified` a final backup. Verify and independent fresh restore, exact rollback compatibility, and independent review remain required. Current implementation and execution status belongs to TASKS; this contract is not evidence that a new backup or deployment has run. The daily timer remains deferred.

## Installation and recovery evidence

Before installing or changing a job, record immutable release commit/tree, wrapper and unit hashes, owner/mode, current-schema freeze/SHA evidence, key identities without key bytes, verify/fresh-restore result, upload/GET verification and timer next-run. Use isolated synthetic/fake tests first. Do not replace CURRENT with a backup or rewrite historical task/attempt records to satisfy quiet gates.

Previous recovery packages and exact old v0.7.15 code are retained. The current rollback identity, latest backup location and reviewed operation script are recorded in the v0.7.16 receipt. Do not restore any backup into CURRENT or substitute old v0.7.14/v0.7.13 evidence for the present release.

## Historical tools and authorization

`backup-data-schema39.mjs` is retained only as historical format evidence and exits with `HISTORICAL_SCHEMA39_BACKUP_DISABLED`. Repository `scripts/backup-to-oss.mjs` and `mirror-oss-to-local.mjs` are also frozen stubs; they are not the installed old server bytes.

Future production changes, real OSS upload/delete/restore and paid generation follow the user's actual authorization. This README and consumed old release permissions do not authorize them. Both permanently protected JSON paths in AGENTS remain excluded from all snapshots, inventories and Git operations.

## Governance documents

The private server entry is `/opt/unboundry/AGENTS.md`, installed from [the navigation source](GOVERNANCE_AGENT_ENTRY.md). It routes to `/opt/unboundry/governance/current`, an export from an exact GitHub main commit. Its `.governance-manifest.json` owns the deployed document identity and hashes. See [the document synchronization procedure](../../RELEASE_RUNBOOK.md) and [the current task](../../TASKS.md) for execution status. These documents are separate from the immutable product release and are not served publicly.
