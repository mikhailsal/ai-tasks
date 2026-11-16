# Agent guide

For AI agents that drive the CLI. Every command here runs as `node dist/cli.js <command> --json`
from the package directory. Use a scratch database while you learn:

```bash
export AI_TASKS_DB_PATH="$(mktemp -d)/scratch.sqlite"
export AI_TASKS_BACKUP_DIR="$(dirname "$AI_TASKS_DB_PATH")/backups"
npm run db:migrate
```

Without `AI_TASKS_DB_PATH` the CLI uses `data/ai-tasks.sqlite` in the working directory. If
that file does not exist the command fails and tells you to run `npm run db:migrate`.

Always pass `--json`. The human-readable mode omits identifiers and revision values that
your next change needs. Errors are JSON on stderr in both modes.

Examples below use a small helper to read one field from a JSON response:

```bash
ai() { node dist/cli.js "$@"; }
field() { node -pe "const d=JSON.parse(require('fs').readFileSync(0));$1"; }
```

## 0. Ask the command

`help <command words> --json` returns everything one command needs: its fields with types
and allowed values, every revision value with the command that supplies it, and a runnable
example whose placeholders name their source (`{"command":"task get","path":"data.revision"}`)
or say `{"generate":"uuid"}`. Paths use dots, `[n]` for an index and `[key=value]` to pick a
list item. `help --json` lists all commands; `help task --json` lists one family. Help works
without a database.

```bash
ai help occurrence complete --json
```

### Advisories

A successful response may carry `advisories`: short notes that do not change the result but
change what you should do next. Each has a stable `code`, a fixed `message`, a `remedy` hint
and, when it concerns one item, a `subject`. Act on the remedy; the list of codes is in
[advisories.md](advisories.md). In human mode they are printed on stderr.

### Is the recurring worker running?

Occurrences are created by a worker, not by reads. `meta --all-projects --json` lists
`data.workers`: per active project `status` (`healthy`, `stale`, `never`), `last_pass_at` and
`tolerance_seconds` (300). Project reads carry the same `worker` field. A worker that has not
passed for more than 300 s is `stale`. While it is `stale` or `never`, reads of a project with
an active recurring task (occurrence list, get and progress, recurrence get, agenda, task list and get)
carry `worker_stale` or `worker_never_ran`: an empty occurrence list then means "not created
yet", not "nothing due". Start the service with `serve --all-projects`, which runs a worker for
each active project; `worker run --project SLUG` runs one by hand. Reading the status never
starts or stops a worker.

## 1. Choose a read scope

Every application read needs a scope. Writes always need `--project`.

| You want      | Use              |
| ------------- | ---------------- |
| One project   | `--project SLUG` |
| Every project | `--all-projects` |

The two flags exclude each other. Lists, `agenda`, `priorities`, `stats` and `meta` accept
either. Reads of one entity (`task get`, `config get`, `recurrence get`) need `--project`.
`backup list`, `backup validate` and `backup status` need `--all-projects`.
Without a scope you get `VALIDATION_ERROR` (exit 2) with a `choose_scope` hint.

## 2. Revision values

A change proves that you saw the current state. Send these values in the flat JSON input
(`--input file.json` or `--input -`), beside the command fields. Do not wrap them in
`payload`. Do not send a value both as a flag and in the input, even when equal.

| Field                        | What it is                            | Where to read it                                                              |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `operation_id`               | Identity of this change               | Generate a new UUID per change. Reuse it only to retry the exact same request |
| `database_epoch`             | Identity of the database generation   | `meta.database_epoch` in any read response (`meta --all-projects`)            |
| `expected_revision`          | Revision of the target entity         | `data.revision` from `task get TASK_ID` (parent task for occurrence work)     |
| `expected_config_revision`   | Revision of the project configuration | `data.revision` from `config get`                                             |
| `expected_settings_revision` | Revision of the global settings       | `data.revision` from `settings get`. Required for recurring tasks             |

Rules of thumb:

- Every mutation sends `operation_id` and `database_epoch`.
- Changing an existing task, creating a task, or changing its status also sends
  `expected_config_revision`. Changing an existing entity also sends `expected_revision`.
  Creating a task sends no `expected_revision`.
- Anything schedule-dependent also sends `expected_settings_revision`: `recurrence
configure`, `control`, `tick`, `occurrence complete`, and create, transition, archive,
  restore or position of a recurring task. Ordinary tasks and `occurrence cancel` do not.
- `config migrate` sends the current configuration revision twice: as `expected_revision`
  and as `expected_config_revision`.
- Occurrence work also lists each occurrence's own `expected_revision` in
  `occurrences[]`. Read it from `occurrence list TASK_ID`.
- Read again before every change. Revisions change after each accepted change.

Missing values are reported together in `details.missing[]`, each with the command that
supplies it. One follow-up request is enough.

## 3. How refusals look

A refusal is one JSON object on stderr and a nonzero exit status. Branch on `error.code`.
The `message` is English for people and may change.

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": {},
    "retryable": false
  }
}
```

Codes, exit statuses and HTTP statuses do not change with this content. The keys below
appear only inside `error.details`. Tolerate their absence: older builds do not send them.

| Key                                     | Meaning                                                                                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issues[]`                              | Invalid input fields. Each has `code`, `path` and, depending on the code, `allowed` (a fixed set of values), `expected` (the type or shape at that place) or `alternatives` (what each accepted shape expects) |
| `missing[]`                             | Every missing revision value: `field` and `source` (a hint naming the command that supplies it)                                                                                                                |
| `names`, `names_omitted`, `suggestions` | Unrecognized field, option or command names (safe form only, at most 10), how many more were received, and the nearest valid names                                                                             |
| `option`, `supported_options`           | An option the command does not support, and the options it does support                                                                                                                                        |
| `hints[]`                               | Next steps, each `{action, text, command?, field?}`                                                                                                                                                            |
| `blockers[]`                            | Every reason a recurring-task request was refused (section 4)                                                                                                                                                  |

Lists are cut at fixed bounds (10 problems, hints and blockers, 20 allowed values). A cut
list comes with a count of what was left out (`..._omitted`, or `omitted` in a blocker).
Responses never repeat values you sent.

### Hint actions

`hints[].action` comes from a closed list:

| Action                 | Do this                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `choose_scope`         | Add `--project SLUG` or `--all-projects`                                                                          |
| `read_revision`        | Read the value with the named `command` and send it in `field`                                                    |
| `read_allowed_values`  | The allowed values depend on project configuration. Read them with the named `command` (for example `config get`) |
| `pause_parent`         | Pause the recurring task (`recurrence control` with a paused status)                                              |
| `cancel_future`        | Cancel future pending occurrences (`occurrence cancel`)                                                           |
| `complete_occurrence`  | Complete the occurrence (`occurrence complete`)                                                                   |
| `close_as_missed`      | Close the owed occurrence as missed with a reason. Offered once that capability ships                             |
| `run_tick`             | Run `recurrence tick` until old owed anchors are materialized                                                     |
| `run_migration`        | Run `npm run db:migrate`                                                                                          |
| `use_supported_option` | Use one of `supported_options`                                                                                    |

### Blockers

`blockers[]` is listed in the order the steps must be taken. Each entry is
`{reason, count, occurrence_ids, omitted, step}`. `occurrence_ids` holds at most 10 ids;
`omitted` counts the rest. `step` is a hint.

| `reason`            | Meaning                                                                           | Usual step                  |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| `owed_anchors`      | Old active-period anchors are not yet materialized                                | `run_tick`                  |
| `parent_not_paused` | The recurring task is still active                                                | `pause_parent`              |
| `future_pending`    | Future pending occurrences exist                                                  | `cancel_future`             |
| `past_pending`      | Pending occurrences whose deadline passed, still inside their window              | `complete_occurrence`       |
| `owed`              | Debt: missed occurrences under the carry-forward policy. They cannot be cancelled | `complete_occurrence`       |
| `not_pending`       | The occurrence is not pending, so it cannot be cancelled                          | Leave it out of the request |

Owed work is stored with the occurrence state `debt`. Do not pause a daily habit to get past
an owed blocker: pausing does not clear it. Complete the occurrence.

### Common refusals and what to do

| You see                                                   | Do this                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`, hint `choose_scope`                   | Add a scope (section 1)                                                                                  |
| `VALIDATION_ERROR`, `issues[].allowed`                    | Use one of the listed values                                                                             |
| `VALIDATION_ERROR`, hint `read_allowed_values`            | Read `config get` and use a configured status or level id                                                |
| `VALIDATION_ERROR`, `issues[].expected` or `alternatives` | Match the expected type or one listed alternative                                                        |
| `VALIDATION_ERROR`, `missing[]`                           | Read each listed value and resend once with all of them                                                  |
| `VALIDATION_ERROR`, `names` and `suggestions`             | Fix the name using `suggestions`                                                                         |
| `VALIDATION_ERROR`, `option` and `supported_options`      | Drop the option or use a supported one                                                                   |
| `VALIDATION_ERROR`, `blockers[]`                          | Follow the `step` of each blocker in order, then retry with a new `operation_id`                         |
| `REVISION_CONFLICT`                                       | Read the entity again, revise the request, send a new `operation_id`                                     |
| `CONFIG_CONFLICT`                                         | Read `config get` (or `settings get` when `scope` is settings) again and retry with a new `operation_id` |
| `DATABASE_EPOCH_CONFLICT`                                 | Read `meta --all-projects` for the new epoch. State may have been restored: re-read everything           |
| `IDEMPOTENCY_CONFLICT`                                    | You reused an `operation_id` with a different body. Use a new UUID                                       |
| `INTERNAL_ERROR`, hint `run_migration`                    | The database does not exist. Set `AI_TASKS_DB_PATH` and run `npm run db:migrate`                         |
| `DB_CONFLICT`, `MAINTENANCE`                              | Retry the exact same request later                                                                       |

After an uncertain outcome (lost response), retry the exact same request with the same
`operation_id`. It returns the original result and never applies twice.

## 4. Recipes

Each recipe assumes the helpers above, a migrated scratch database, and a project `demo`.
Run them in order from one directory. Create the project once. The `meta` call also gives the epoch.

```bash
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
cat > project.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","slug":"demo","name":"Demo","emoji":"🧭","priority":10}
EOF
ai project create --project demo --input project.json --json
```

### Create the first task

```bash
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
cat > task.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_config_revision":$CONFIG_REV,
 "kind":"ordinary","title":"First task","priority":{"model":"classic","level":"normal"}}
EOF
ai task create --project demo --input task.json --json
ai task list --project demo --json
```

The task id is `data.id` of the create response. Without a `deadline` the task has none.

### Update or move a task

Updates need the task revision and the configuration revision. A move between statuses is
`task transition` with `to_status_id`; read allowed statuses and edges from `config get`.

```bash
TASK=$(ai task list --project demo --kind ordinary --json | field 'd.data.items[0].id')
REV=$(ai task get "$TASK" --project demo --json | field 'd.data.revision')
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
cat > update.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"title":"Renamed task","deadline":"2030-01-01T18:00:00.000+03:00"}
EOF
ai task update "$TASK" --project demo --input update.json --json
```

Timestamps are RFC 3339 with an offset. A deadline in the past is accepted. For a move, send
`to_status_id` (and `confirmation` when the edge requires one) to `task transition "$TASK"`.
Re-read `expected_revision` first: the update changed it.

### One-call shortcuts

Two writes need no tokens. The application reads the revisions under its own lock and runs
the strict handler, so the audit trail is the same as the strict form's.

```bash
ai task move 📘 --project demo --to planning --from idea --json
ai occurrence done 🌙 --project demo --day 2026-11-08 --note "время примерное" --json
```

`<task>` is a task ID or its reserved icon in the project; ⚪ never names a task. A repeat
with the same data returns `data.existing: true` and writes nothing; different data for a
completed occurrence is refused with `details.existing`. `--from` refuses without change
when the task is elsewhere (`details.actual_status`). No match gives `TASK_NOT_FOUND` with
`details.nearest_days`; several occurrences on one day give `details.candidates`, then pass
`--occurrence ID`. A not-allowed target lists `details.allowed`.

The shortcut checks `database_epoch` for you, so it cannot detect that the database was
restored between your last read and this call. After a restore, re-read before writing:
the shortcut acts on the restored state.

### Create a recurring task

A recurring task needs all three revision kinds and a nested `recurrence`. It starts in
`draft` with no occurrences. Activating it creates them. The first deadline may be in the
past: missed periods become owed work.

```bash
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
SETTINGS_REV=$(ai settings get --project demo --json | field 'd.data.revision')
FIRST=$(node -e 'console.log(new Date(Date.now()-3*864e5).toISOString())')
cat > recurring.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_config_revision":$CONFIG_REV,
 "expected_settings_revision":$SETTINGS_REV,"kind":"recurring","title":"Daily habit",
 "recurrence":{"first_deadline":"$FIRST",
  "schedule":{"mode":"calendar","pattern":"days","every":1,"local_time":"09:00:00.000"},
  "miss_policy":"carry_forward","confirmation_window_ms":3600000}}
EOF
ai task create --project demo --input recurring.json --json > created.json
HABIT=$(field 'd.data.id' < created.json)
```

`local_time` may be left out: it is then the local time of `first_deadline`, and the
response says so with the advisory `schedule_time_derived`. If you give both and they differ,
the task is created as asked and `schedule_time_mismatch` names both times; later occurrences
use `local_time`. While the task is in `draft` every response about it carries
`recurring_not_generating` with the statuses to move it to.

For a cycle that follows the real completion date use
`"schedule":{"mode":"after_completion","unit":"days","every":3}`.

Activate it (`draft` to `active`) with `recurrence control`:

```bash
REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
SETTINGS_REV=$(ai settings get --project demo --json | field 'd.data.revision')
cat > activate.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"expected_settings_revision":$SETTINGS_REV,
 "to_status_id":"active"}
EOF
ai recurrence control "$HABIT" --project demo --input activate.json --json
ai occurrence list "$HABIT" --project demo --json
```

### Pause and cancel future occurrences

Only future pending occurrences of a paused task can be cancelled. Skipping one future
occurrence is the same steps, then resuming with `to_status_id: "active"`.

```bash
REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
SETTINGS_REV=$(ai settings get --project demo --json | field 'd.data.revision')
cat > pause.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"expected_settings_revision":$SETTINGS_REV,
 "to_status_id":"paused"}
EOF
ai recurrence control "$HABIT" --project demo --input pause.json --json

REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
OCC=$(ai occurrence list "$HABIT" --project demo --state pending --json | field 'JSON.stringify(d.data.items.map(o=>({id:o.id,expected_revision:o.revision})))')
cat > cancel.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"reason":"Retiring the habit","occurrences":$OCC}
EOF
ai occurrence cancel "$HABIT" --project demo --input cancel.json --json
```

A reason is required. Owed occurrences cannot be cancelled. Cancelling a row that is not a
future pending one is refused with `blockers[]`.

### Complete owed occurrences

List the owed rows (state `debt`), then complete them by id. Add `actual_completed_at` per
row to record when the work really happened. It cannot be in the future. A row completed
after its window becomes `completed_late`. The state means only that the completion was
recorded after the window; it says nothing about when the work was done. Both the
miss and the completion time are kept.

```bash
REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
SETTINGS_REV=$(ai settings get --project demo --json | field 'd.data.revision')
OCC=$(ai occurrence list "$HABIT" --project demo --state debt --json | field 'JSON.stringify(d.data.items.map(o=>({id:o.id,expected_revision:o.revision})))')
cat > complete.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"expected_settings_revision":$SETTINGS_REV,
 "occurrences":$OCC}
EOF
ai occurrence complete "$HABIT" --project demo --input complete.json --json
```

The batch is all or nothing: one stale or foreign row rolls back everything. To complete a
pending occurrence, use the same input with `--state pending`.

### Record a miss or close owed work

When the person says an occurrence will not be done, record it as missed right away, with
the reason they gave. Owed rows (`debt`) and rows of a carry-forward task need a reason; the
row then stops being owed and never becomes owed again. Add `"note"` to a completion item to
say, for example, that the time is an estimate.

```bash
REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
OCC=$(ai occurrence list "$HABIT" --project demo --state debt --json | field 'JSON.stringify(d.data.items.map(o=>({id:o.id,expected_revision:o.revision})))')
cat > miss.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"expected_settings_revision":$SETTINGS_REV,
 "occurrences":$OCC,"reason":"The person decided not to make these up"}
EOF
ai occurrence miss "$HABIT" --project demo --input miss.json --json
```

A row that is already completed, cancelled or missed with a reason is refused with
`blockers[]` naming its state. Repeating the same request with the same `operation_id`
returns the stored result and writes nothing.

### Days, measured values and goal progress

Every occurrence has an `occurrence_day` (`YYYY-MM-DD`). It is the local date of its deadline,
where the project's day starts at `day_start_hour` (0 by default; set it with `project update`
and `"day_start_hour": 4` so a 01:30 bedtime belongs to the evening before). The day is stored
when the occurrence is created and never recomputed: a rule change applies only to occurrences
created afterwards, and occurrences already created ahead of their deadline keep the old rule.

A recurring task can declare up to 8 named values in its recurrence input
(`"values":[{"name":"asleep_at","kind":"time_of_day"},{"name":"slept","kind":"duration"}]`;
kinds `number`, `time_of_day` `HH:MM`, `duration` in whole minutes). `recurrence configure`
replaces them, `[]` clears them, leaving the field out keeps them. A completion item may then
carry `"values":{"asleep_at":"23:40","slept":450}`; values are always optional. An unknown name
or a wrong kind is refused with `details.allowed` listing the declared names and kinds.

To answer "how many nights out of 7", ask once:

```bash
ai occurrence progress "$HABIT" --project demo --from-day 2026-11-01 --to-day 2026-11-07 --json
```

`done` counts `completed` and `completed_late`; `decided` adds `missed` and owed (`debt`);
`open` is still pending; cancelled rows are left out. The window is inclusive and at most 366
days. `occurrence list` takes the same days as `--day` or `--from-day`/`--to-day`. Targets
such as "6 of 7" stay in the task text; the application reports, it does not judge.

### Archive a recurring task

Archive is refused while the task is active or has open occurrences. The refusal lists every
blocker with its step. The full order is: run ticks if `owed_anchors`, pause, cancel future
pending, complete past pending and owed. Then archive:

```bash
REV=$(ai task get "$HABIT" --project demo --json | field 'd.data.revision')
EPOCH=$(ai meta --all-projects --json | field 'd.meta.database_epoch')
CONFIG_REV=$(ai config get --project demo --json | field 'd.data.revision')
SETTINGS_REV=$(ai settings get --project demo --json | field 'd.data.revision')
cat > archive.json <<EOF
{"operation_id":"$(uuidgen)","database_epoch":"$EPOCH","expected_revision":$REV,
 "expected_config_revision":$CONFIG_REV,"expected_settings_revision":$SETTINGS_REV}
EOF
ai task archive "$HABIT" --project demo --input archive.json --json
```

Missed records (policy `record_miss`) stay as history and do not block archive. A recurring
archive edge may require `confirmation`; the refusal says so.

## 5. Notes

- Everything above is guarded: you cannot overwrite a newer state by accident.
- Contract details: [common](../specs/001-ai-task-manager/contracts/common.md),
  [CLI](../specs/001-ai-task-manager/contracts/cli.md),
  [diagnostics](../specs/004-agent-diagnostics-onboarding/contracts/diagnostics.md).
- Optional: to start the service after a reboot, run `npm start` from a systemd user unit.
  The application does not install one. See [operations](operations.md).
