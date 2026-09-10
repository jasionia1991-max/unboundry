# Production backup contracts

Current snapshot: 2026-09-09, `v0.7.17/schema43`. Product state, release identity and exact backup results are owned by [current authority](../../spec/UNBOUNDRY_CURRENT_STATE.md) and the [v0.7.17 release receipt](../../spec/V0_7_17_PRODUCTION_RECEIPT_2026-09-09.json). The presence of operation sources in a release does not mean the systemd timer uses them.

## Observed production state

- The application was switched to the exact v0.7.17 package; actual pointer, PID, restart count and verification are in the release receipt rather than duplicated here.
- Daily backup failure remains `USER_DEFERRED`: installed ExecStart still uses `/opt/unboundry/scripts/backup-to-oss.mjs` and its old schema41 validation. The application is schema43; this release did not alter that job.
- The latest stopped-preservation schema43 backup, verify and independent fresh restore passed. Cloud upload/GET status and all counts are owned by the current release receipt; this document does not predeclare cloud completion. The pre-existing nonblocking media warnings remain; a manual backup does not repair or validate the daily timer.

The daily job needs a separately implemented and verified current-schema freeze/backup/restore/upload pipeline and an exact installed-unit receipt. Replacing only a path or schema constant does not provide dynamic freeze and logical-SHA evidence.

## Current wrapper contract

`backup-to-oss-retention.mjs` resolves `scripts/backup-data.mjs` and `server/secureStorageProfiles.ts` from its own immutable release root. Keep it in `ops/production/` within the complete release; do not copy it to a standalone `/opt/unboundry/scripts` path.

Required arguments explicitly identify source, backup root, scratch root, signing-private-key and recovery-public-key paths, storage profile, schema, database logical SHA, generation freeze and last Provider admission. The source schema must match the actual capture and the exact tool contract: quiesced preservation supports explicit schema43/schema44; ordinary current capture is schema44 and older modes remain historical. A production snapshot below does not override these mode boundaries. Unknown/missing/duplicate arguments fail closed. Media warnings and OSS mirrors are explicit repeatable arguments.

Without `--apply-upload`, it creates a local encrypted package and reports an upload inventory; this is not a zero-write dry-run of the local filesystem. It reads the selected source's encrypted storage profile, never an inherited unrelated data directory. With upload authorization, `--apply-upload` writes private no-overwrite objects and a manifest. The wrapper does not itself run separate verify/fresh-restore or GET content verification; the operation must supply these gates. Retention deletion is blocked pending an exact reviewed remote deletion manifest; this is not an active automatic deletion policy.

## Authorized stopped preservation capture

A separately authorized release may use `quiesced-active-preservation` under [Runbook 5.1](../../RELEASE_RUNBOOK.md#51-经当次授权的停服保全备份). It must preserve exact task/attempt/event evidence and hold the existing runtime lease, secret lease and SQLite capture lock after verified shutdown. This is a distinct signed mode; it does not loosen `locked-exact`, turn an unknown task into a terminal task, or make `external-unverified` a final backup. Verify and independent fresh restore, exact rollback compatibility, and independent review remain required. Current implementation and execution status belongs to TASKS; this contract is not evidence that a new backup or deployment has run. The daily timer remains deferred.

## Schema43 to schema44 release preservation bridge

Production remains on the last observed version until an actual release receipt confirms migration. Release approval, including the necessary schema43 to schema44 migration and maintenance-only fallback, is owned by TASKS. This contract is not evidence that production has migrated.

- A schema44 candidate backup must be captured only after the schema43→44 transaction has passed the freeze, lease, logical-SHA, integrity, foreign-key, full-ledger and media checks. The quiesced preservation branch accepts an explicit schema43 source or the current schema44 source and keeps unresolved Provider evidence unchanged.
- The standalone compatibility package contains exactly `preservation-manifest.json`, `maintenance.html`, and `schema44-readonly-preservation-runtime.mjs`. The manifest binds the original CURRENT data directory, database identity, database SHA, media-tree SHA, maintenance-page SHA, and executable SHA. The package contains no `unboundry.sqlite`, `media/`, secret or application bootstrap.
- The executable is started from the package itself and opens the original CURRENT database read-only/query-only. It serves only the maintenance page. Health, result, media, auth, session and every write/POST route return 503 without task details. The process must not run a worker or issue a Provider/OSS request.
- The rehearsal uses one CURRENT throughout: start and drain the new application, run the packaged read-only bridge, stop it, then start the same new application again. It must preserve Canvas drafts and the old unknown/outcome ledger, lease, receipt, continuation and media records; a staged synthetic result may be finalized by the normal new worker exactly once, with zero Provider POSTs.
- Rollback is code-only. Never downgrade the database from schema44 to schema43, restore over CURRENT, or let the old schema43 application open schema44. If the forward application cannot start, keep the bridge/maintenance state and use a schema44-compatible package after investigation.

The exact package and operation scripts must pass independent release review and isolated Linux rehearsal before production operations. Local tests alone do not prove deployment. The latest approval is in TASKS; do not request it again for already covered operations. Timer changes, paid generation and unrelated data operations remain outside that approval.

## Installation and recovery evidence

Before installing or changing a job, record immutable release commit/tree, wrapper and unit hashes, owner/mode, current-schema freeze/SHA evidence, key identities without key bytes, verify/fresh-restore result, upload/GET verification and timer next-run. Use isolated synthetic/fake tests first. Do not replace CURRENT with a backup or rewrite historical task/attempt records to satisfy quiet gates.

Previous recovery packages and exact old v0.7.16 code are retained. The current rollback identity, latest backup location and reviewed operation script are recorded in the v0.7.17 receipt. Do not restore any backup into CURRENT or substitute old v0.7.14/v0.7.13 evidence for the present release.

## Historical tools and authorization

`backup-data-schema39.mjs` is retained only as historical format evidence and exits with `HISTORICAL_SCHEMA39_BACKUP_DISABLED`. Repository `scripts/backup-to-oss.mjs` and `mirror-oss-to-local.mjs` are also frozen stubs; they are not the installed old server bytes.

Future production changes, real OSS upload/delete/restore and paid generation follow the user's actual authorization. This README and consumed old release permissions do not authorize them. Both permanently protected JSON paths in AGENTS remain excluded from all snapshots, inventories and Git operations.

## Governance documents

The private server entry is `/opt/unboundry/AGENTS.md`, installed from [the navigation source](GOVERNANCE_AGENT_ENTRY.md). It routes to `/opt/unboundry/governance/current`, an export from an exact GitHub main commit. Its `.governance-manifest.json` owns the deployed document identity and hashes. See [the document synchronization procedure](../../RELEASE_RUNBOOK.md) and [the current task](../../TASKS.md) for execution status. These documents are separate from the immutable product release and are not served publicly.
