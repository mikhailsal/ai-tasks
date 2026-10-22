# Quickstart and end-to-end validation

The CLI, HTTP API, Russian web UI, migrations, and recovery helpers are implemented. Use
this hands-on guide with an isolated database. [Release validation](../../docs/validation.md)
records actual check results and any remaining gates. See [operations](../../docs/operations.md) for production limits and
[compatibility](../../docs/compatibility.md) for upgrade obligations. Do not edit acceptance
checklists to infer results from this guide.

## Environment and isolated setup

Target Linux on a local filesystem with Node.js `24.22.0` and npm `11.19.1`, pinned in the
repository toolchain files. Native `better-sqlite3` must pass installation and
connection-setting verification on this runtime. Do not place the WAL database on a network
filesystem. Use a disposable database and backup directory for every scenario here:

```bash
cd /path/to/ai-tasks # directory containing package.json
export AI_TASKS_DB_PATH="$(mktemp -d)/validation.sqlite"
export AI_TASKS_BACKUP_DIR="$(mktemp -d)"
npm ci
npm run check:runtime
npm run db:migrate
npm run build
node dist/cli.js meta --all-projects --json
```

The package exposes `ai-tasks` through its bin mapping; the explicit
`node dist/cli.js` form avoids depending on a global install. Start production with
`npm run start` and open `http://127.0.0.1:3000`. For frontend development use `npm run dev`
and open `http://127.0.0.1:5173`; Vite proxies `/api` to the local API. Keep the same database
environment for API and CLI. The supervisor starts workers for active projects; they process due work on startup and every 30 seconds.
CLI-only operation can explicitly invoke `recurrence tick`; reads never process due work.

## Required check commands

```bash
npm run typecheck
npm run lint
npm run test:functional
npm run test:contention
npm run test:e2e
npm run build
npm run check:bundle-size
npm run bench
```

Functional tests use injected domain time and migrated real SQLite fixtures. Contention
tests run independent processes/connections with barriers and their own longer timeout
budget; they verify transient lock success and exhausted wait errors. Browser tests use
production assets and isolated state. Bundle checking sums individually gzipped emitted JS
assets, including lazy chunks and service workers, excluding source maps, and must be below 150,000 bytes.
Benchmark results report the workload/environment/clock boundary and p95; timing goals are
not correctness gates until the documented measurement procedure has been validated.
Report actual commands, exit codes, durations, unavailable checks, and failures honestly.

## Contractual JSON fixtures and CLI smoke

Use [common payload schemas](contracts/common.md) and [command table](contracts/cli.md).
The tokens `EPOCH`, `TASK_UUID`, `CURRENT_REVISION`, and similar labels below are placeholders,
not literal accepted values. Read real IDs/revisions from prior outputs. Generate one fresh
UUID per new mutation; keep it unchanged only for an exact retry. No command guesses the
current revision. Save the following as `project-create.json` in the disposable directory,
substituting the UUID values from `meta` and a UUID generator:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "EPOCH",
  "slug": "demo",
  "name": "Validation project",
  "emoji": "🧭",
  "priority": 10
}
```

```bash
node dist/cli.js project create --project demo --input project-create.json --json
node dist/cli.js project get --project demo --json
node dist/cli.js config get --project demo --json
node dist/cli.js config presets --project demo --json
```

Verify the classic model, unset task priority default, six forward-chain states plus
cancelled, configured backward/cancellation/reopen edges, and the confirmation-required
`sanity_check → done` edge. Save a task payload with the read config revision:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "EPOCH",
  "expected_config_revision": 1,
  "kind": "ordinary",
  "title": "Check the complete workflow",
  "description": "## Context\nA disposable acceptance task.\n\n## Plan\n- Verify the shared interfaces.",
  "emoji": "🧪",
  "priority": { "model": "classic", "level": "high" },
  "deadline": "2026-10-22T18:00:00.000+03:00"
}
```

`1` above is illustrative: replace it with the actual `config get` revision before running.

```bash
node dist/cli.js task create --project demo --input task-create.json --json
node dist/cli.js task get TASK_UUID --project demo --json
node dist/cli.js task list --all-projects --json
node dist/cli.js agenda --project demo --json
node dist/cli.js priorities --all-projects --json
node dist/cli.js stats --project demo --json
node dist/cli.js audit list --project demo --entity-id TASK_UUID --json
```

Use a `task-transition.json` containing the current envelope, `to_status_id`, and when
required `confirmation:{"asserted":true,"user_text":"I confirm this specific task is complete."}`.
Run `task transition TASK_UUID --project demo --input task-transition.json --json` for each
forward step, re-reading revisions between writes. Verify a skipped edge and missing
confirmation fail, the valid last transition succeeds, audit shows before/after plus
confirmation text, and a restart preserves the result. Repeat the exact final command and
verify no second audit record. Change its body but keep its operation ID and expect
`IDEMPOTENCY_CONFLICT`.

## Configuration, dependencies, and conflicts

Create three more isolated projects with distinct project emoji and Eisenhower, named,
and numeric models. Read full presets rather than inventing hidden defaults. Use
`config preview --project demo --input config-preview.json --json` with only `config`,
`status_mappings`, `priority_mappings`, and `affected_tasks` (initially `[]`). Preview is a
pure read and rejects mutation guards. Copy these fields into `config-migration.json`,
fill `affected_tasks` with the returned task revisions, and add a fresh `operation_id`, the
current `database_epoch`, and both `expected_revision` and `expected_config_revision`
set to the current configuration revision from `config get` (`data.revision`). Include current `expected_settings_revision` when recurring
behavior changes. Keep these CLI guards at the top level beside the four migration fields;
re-read metadata, project and configuration before preparing the guarded file. Commit via
`config migrate --project demo --input config-migration.json --json`. Verify incomplete
mappings roll back config, task state, and success audit; complete mappings preserve old
meanings in history. Config update races must produce `CONFIG_CONFLICT`.

Create an ordinary prerequisite in a second project. Use
`dependency add TASK_UUID --project demo --input dependency-add.json --json` with its explicit
project/UUID and the dependent task's current revision. Verify blocked advancement until
the prerequisite is completed, cross-project cycles and recurring endpoints rejected,
cancelled prerequisite unsatisfied, and no automatic dependent transitions. Inspect via
`dependency list TASK_UUID --project demo --json`; remove through `dependency remove` using
the same identifier shape and fresh mutation envelope.

Open the same task in the UI and CLI. Save a description through CLI, then save the UI's
older draft. Expect `REVISION_CONFLICT`, unchanged new description/audit, and retained UI
draft. Repeat with title, priority, dependency, and config races as appropriate. Check
`PROJECT_MISMATCH` by writing the task under another existing project. Check occupied task
emoji, project-reserved emoji, and repeatable `⚪`. Every rejection leaves state/audit intact.

## Recurrence boundary and recovery scenarios

Create a recurring parent using `task create` with `kind:"recurring"`, a nested
`recurrence:{first_deadline,schedule,miss_policy,confirmation_window_ms}`, and current
`expected_config_revision`/`expected_settings_revision`, epoch, and operation ID. A recurring
parent has no ordinary `deadline` field and initially remains draft without occurrences.
For a later rule change, configure it using
`recurrence configure RECURRING_UUID --project demo --input recurrence.json --json`:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "EPOCH",
  "expected_revision": 2,
  "expected_config_revision": 1,
  "expected_settings_revision": 1,
  "first_deadline": "2026-10-22T09:00:00.000+03:00",
  "schedule": { "mode": "calendar", "pattern": "days", "every": 1, "local_time": "09:00:00.000" },
  "miss_policy": "carry_forward",
  "confirmation_window_ms": 3600000
}
```

Replace the illustrative entity/config/settings revisions with fresh reads. For a manual
run, choose a future first deadline; automated fixtures use injected domain time. Schedule-dependent create/configure/control/complete/tick requests include the settings revision. Activate using `recurrence control` with `to_status_id:"active"`. Use `recurrence get`,
`occurrence list`, and `occurrence get` to observe conditions/snapshots. A project-scoped
`recurrence tick --input tick.json` supplies the selected task IDs/revisions and fresh
envelope; it does not accept a production clock override.

The automated acceptance fixture controls time: mark at `deadline + window` and verify
`completed`; mark one millisecond after and verify `completed_late` with preserved miss
audit. Test all four timing/policy combinations, overlapping calendar debts, explicit debt
selection, no next completion-relative deadline before actual completion, actual-time-based
next deadline, month-end clamp, selected weekdays, DST fold/gap generation, timezone change,
duplicate/concurrent ticks, and service downtime catch-up. Verify each materialized occurrence captures the parent
description and later edits do not change its frozen text.

Use `occurrence complete RECURRING_UUID --project demo --input complete.json --json` with
`occurrences:[{id,expected_revision,actual_completed_at?}]` and current parent revision.
Mix a foreign or stale row into a batch and verify total rollback. Pause with
`recurrence control`, then cancel only future pending rows using `occurrence cancel` with
explicit IDs/revisions and reason. Debts must be completed. Verify archive blocked while
pending/debt remains, pause periods never caught up, preexisting windows continue, project
archive is read-only, and restore leaves recurring work paused. Completion-relative resume
requests a new explicit first deadline when a paused-period candidate cannot be reused.

Read settings with `settings get --all-projects --json`; apply a timezone change with
`settings update --project demo --input settings.json --json`, using current
`expected_settings_revision`, attribution-project `expected_config_revision`, `database_epoch`,
`operation_id`, and the flat command field `timezone:"Europe/Moscow"`. Existing
instants remain fixed; future calendar instants follow the selected zone.

## Offline and safe restore

Load agenda, priorities, task details, and descriptions in the UI. Disconnect/reload/reopen:
the shell and loaded snapshots remain readable, offline/last-refresh is visible, uncached
details explain missing data, and all mutation controls are disabled. Reconnect after a CLI
description edit; the draft survives and cannot silently overwrite the new state. Verify
unsafe Markdown never executes and every screen stays inside the 430px column.

Only against the disposable paths above, run `backup create --project demo --input
backup-create.json --json` with the current settings/config revision and envelope. Inspect
with `backup list --all-projects --json` and `backup validate BACKUP_UUID --all-projects
--json`. Change a task and create another project so restore must reconcile both backup and
current project sets. Prepare `restore.json` with current settings revision/epoch, unique
operation ID, backup ID, confirmation, and the exact validated union:

```json
{
  "operation_id": "NEW_UUID",
  "database_epoch": "CURRENT_EPOCH",
  "expected_config_revision": 1,
  "expected_settings_revision": 1,
  "backup_id": "BACKUP_UUID",
  "affected_projects": [
    { "project_slug": "demo", "expected_revision": 2, "expected_config_revision": 1 }
  ],
  "confirmation": {
    "asserted": true,
    "user_text": "Restore this disposable validation database and preserve its audit history."
  }
}
```

The one-project array is only a shape example: include every current/backup project and its
actual revisions; backup-only rows use null current revisions. The top-level config token
is for the attribution project; restore has no top-level entity `expected_revision`. Run
`backup restore --project demo --input restore.json --json`, or use the equivalent UI flow.
Restore waits for terminal completion by default; `--no-wait` returns the durable accepted
receipt while an isolated owner continues after CLI exit. Check the job with
`backup status JOB_UUID --all-projects --json` during maintenance.
Verify omitted project scope fails before replacement; successful restore creates a new
epoch, preserves the union of immutable old/new audit records, adds one recovery record per
affected project, and leaves a pre-restore recovery snapshot. Old clients must receive
`DATABASE_EPOCH_CONFLICT`. Retry the exact restore after epoch change and verify rejection;
use `backup status --operation-id
ORIGINAL_OPERATION_UUID --all-projects --json` to recover the external receipt without
restoring again. Test failure before atomic replacement and unreadable current audit refusal while
preserving database bytes. Do not run recovery acceptance against a working personal DB.

Finish by recording checks and results against [the spec](spec.md), [the plan](plan.md), and
all interface contracts. Documentation review alone does not establish runtime acceptance.

## Analysis remediation acceptance cases

- Configure a recurring archived-to-paused edge to require confirmation. Direct task restore
  without assertion/text must fail without state/audit changes; the same valid proposal with
  a new operation ID and TaskRestore.confirmation succeeds through CLI and UI/API and audits
  that evidence. Ordinary restore does not accept this field.
- Fetch the first agenda page, advance the injected clock across a deadline and local midnight
  without changing data, and fetch the remaining pages. All pages retain meta.as_of, with no
  missing/duplicate rows or changed bucket classification. A fresh first-page request captures
  a new as_of and reflects the elapsed time; CLI/API reject a supplied clock override.
- For statistics, verify timestamps exactly at from count and timestamps exactly at to do not;
  omitted bounds are unbounded, equal bounds give empty counts, reversed bounds fail, and null
  metric timestamps are excluded only when at least one bound exists.
- Migrate a completed prerequisite into a non-completed category while a cross-project dependent
  remains advanced. The dependent stays in place and becomes blocked for its next guarded
  transition; the migration succeeds if other invariants pass. Conversely, a changed dependent
  status/category ending in_progress/review/completed must have all prerequisites completed in
  the projected final state. Label/color/edge/priority-only changes do not recheck satisfaction.
- Create a backup, change a project's meaningful marker A to B, and restore the older backup.
  Both A and B remain permanently reserved to that project slug. Repeat with a project created
  after backup and absent from restored project state: its marker remains reserved. A staged
  marker or reservation-owner conflict returns EMOJI_CONFLICT before publication, leaving the
  current DB and immutable audit intact; no automatic marker rewrite is allowed.
- Recheck native smoke and the real migrated/compiled harness on the deployment runtime.
  Keep build-dependent checks sequential so live helpers never use replaced bundles. Bundle
  accounting rejects a total of exactly 150,000 bytes.

These are acceptance procedures. Consult recorded validation evidence for actual runs; this
guide does not establish final release acceptance.
