# Production backup contracts

Current snapshot: 2026-09-07, `v0.7.15/schema43`. See [current authority](../../spec/UNBOUNDRY_CURRENT_STATE.md) and [v0.7.15 release receipt](../../spec/V0_7_15_PRODUCTION_RECEIPT_2026-09-07.json). This directory contains operation sources; their presence in a release does not mean the systemd timer uses them.

## Observed production state

- Application: active/running, PID1088583, NRestarts0; current points to `/opt/unboundry/releases/v0.7.15-bug-ui-20260907`.
- Daily timer: failure remains `USER_DEFERRED`; the installed job still uses the old schema41 path and has not been repaired.
- Installed ExecStart still invokes `/opt/unboundry/scripts/backup-to-oss.mjs`, which invokes the old standalone `backup-data.mjs`. Its validation requires schema41; production is schema43. Journal reports `Backup database validation failed`.
- The current manual schema43 encrypted backup is under `/var/lib/unboundry-v0715-bug-ui-20260907`, backup `cf5cd5b5-c9d2-4f45-b39a-100cd6ccd6f8`: verify and fresh restore passed, with 355 media, 648 mirrors and 3 secrets; 98 historical nonblocking warnings remain. Cloud upload and per-file GET hash/size verification passed; exact transfer counts are owned by the release receipt. This does not repair or validate the daily job.

The daily job needs a separately implemented and verified current-schema freeze/backup/restore/upload pipeline and an exact installed-unit receipt. Merely replacing a path or schema constant does not supply dynamic freeze and logical-SHA evidence. The v0.7.15 deployment and current backup evidence are owned by the linked release receipt; this README does not mark the deferred daily job repaired.

## Current wrapper contract

`backup-to-oss-retention.mjs` resolves `scripts/backup-data.mjs` and `server/secureStorageProfiles.ts` from its own immutable release root. Keep it in `ops/production/` within the complete release; do not copy it to a standalone `/opt/unboundry/scripts` path.

Required arguments explicitly identify source, backup root, scratch root, signing-private-key and recovery-public-key paths, storage profile, schema, database logical SHA, generation freeze and last Provider admission. Schema43 is current/final; schema42 is historical recovery. Unknown/missing/duplicate arguments fail closed. Media warnings and OSS mirrors are explicit repeatable arguments.

Without `--apply-upload`, it creates a local encrypted package and reports an upload inventory; this is not a zero-write dry-run of the local filesystem. It reads the selected source's encrypted storage profile, never an inherited unrelated data directory. With upload authorization, `--apply-upload` writes private no-overwrite objects and a manifest. The wrapper does not itself run separate verify/fresh-restore or GET content verification; the operation must supply these gates. Retention deletion is blocked pending an exact reviewed remote deletion manifest; this is not an active automatic deletion policy.

## Installation and recovery evidence

Before installing or changing a job, record immutable release commit/tree, wrapper and unit hashes, owner/mode, current-schema freeze/SHA evidence, key identities without key bytes, verify/fresh-restore result, upload/GET verification and timer next-run. Use isolated synthetic/fake tests first. Do not replace CURRENT with a backup or rewrite historical task/attempt records to satisfy quiet gates.

The previous v0.7.14 recovery package remains `/var/lib/unboundry-v0714-media-aspect-20260906/backup43/1779934b-9d23-4a9d-849d-531f21d678b7.ubbackup`; it is retained for the reviewed rollback route. Do not use the old v0.7.13 path or claim every historic asset is intact. The current v0.7.15 cloud verification result is recorded in the linked release receipt.

## Historical tools and authorization

`backup-data-schema39.mjs` is retained only as historical format evidence and exits with `HISTORICAL_SCHEMA39_BACKUP_DISABLED`. Repository `scripts/backup-to-oss.mjs` and `mirror-oss-to-local.mjs` are also frozen stubs; they are not the installed old server bytes.

Future production changes, real OSS upload/delete/restore and paid generation follow the user's actual authorization. This README and consumed old release permissions do not authorize them. Both permanently protected JSON paths in AGENTS remain excluded from all snapshots, inventories and Git operations.

## Governance documents

The private server entry is `/opt/unboundry/AGENTS.md`, installed from [the navigation source](GOVERNANCE_AGENT_ENTRY.md). It routes to `/opt/unboundry/governance/current`, an export from an exact GitHub main commit. Its `.governance-manifest.json` owns the deployed document identity and hashes. See [the document synchronization procedure](../../RELEASE_RUNBOOK.md) and [the current task](../../TASKS.md) for execution status. These documents are separate from the immutable product release and are not served publicly.
