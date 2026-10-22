# Agent CLI v1

Planned executable: `ai-tasks`; production entry: `node dist/cli.js`. Commands below are
contract targets for implementation. [Common schemas](common.md) are normative.

## Invocation

Every application command supports `--json`. In JSON mode, success writes exactly one JSON
envelope and newline to stdout, exits `0`, and writes no stderr. Any failure, including
Commander argument parsing, writes one structured error envelope and newline to stderr,
writes no success stdout, and exits according to the common error table. Human success
output is concise text; failure JSON is stable in both modes. No prompts, pagers, spinners,
ANSI colors in JSON, or diagnostic stdout. `--help` and `--version` are informational;
`help --json` and `version --json` provide machine-readable equivalents.
These informational commands work without opening a database and return
`{ok:true,data:{...}}` without database metadata. Domain and operational application
commands retain the full shared response envelopes.

Common options:

| Option | Meaning |
|---|---|
| `--project <slug>` | Required mutation scope; single-project read scope |
| `--all-projects` | Explicit aggregate read scope; mutually exclusive with `--project` |
| `--json` | Structured response |
| `--operation-id <uuid>` | Required for every mutation, chosen once and reused for exact retry |
| `--database-epoch <uuid>` | Required mutation epoch from a successful read |
| `--expected-revision <integer>` | Existing target revision |
| `--expected-config-revision <integer>` | Current project config revision for project-owned writes |
| `--expected-settings-revision <integer>` | Required for schedule-dependent writes to detect timezone changes |
| `--input <file>` or `--input -` | UTF-8 JSON payload from file or stdin; mutually exclusive sources |
| `--limit <1..200>`, `--cursor <opaque>` | Pagination for list/read views |

Structured payloads use files/stdin, never giant inline JSON arguments. Input files contain
the operation-specific payload and may also contain `operation_id`, `database_epoch`,
`expected_revision`, `expected_config_revision`, `expected_settings_revision`. Supplying a field in both flags and JSON is
an error, even when equal. Project scope always comes from `--project`; a payload containing
`project_slug` must equal that scope. Transport-only IDs/options are normalized before
calling core. Reads accept query fields in `--input` where filtering needs structured values.
Paginated domain reads and statistics return meta.as_of separately from meta.now. A cursor
retains its original server-selected as_of; neither input JSON nor CLI flags may override
the clock. Statistics from/to input fields follow half-open [from,to) with the shared
equal/reversed/null-timestamp rules.
Simple flags include `--q`, `--status`, `--category`, `--kind`, `--emoji`,
`--archive <exclude|include|only>`, and `--include-terminal`; priority filters use input JSON.

`AI_TASKS_DB_PATH` selects the local SQLite database, consistently for CLI and server.
`AI_TASKS_BACKUP_DIR` selects managed snapshots. CLI actor is always `ai-cli:<project_slug>`;
clients cannot impersonate `human-web`. Global operational mutations still require an
explicit project attribution context. All-project reads produce no domain audit entries.

## Complete application command surface

`M` means domain mutation envelope/preconditions apply. `R` means read-only. `O` means
operational command; backup/restore use the documented operation envelope and manifest
receipts, whereas process startup requires scope but no database mutation preconditions.
Argument IDs shown in
angle brackets are positional. All result names refer to common schemas and success
envelopes. There are no implicit mutations during reads.

| Command | Type | Input and result |
|---|---|---|
| `meta` | R | `--all-projects`; epoch, timezone, settings revision, contract/schema version, maintenance status |
| `serve` | O | `--all-projects`; start loopback API/UI supervisor and scoped recurrence workers; no arbitrary listen-host option |
| `worker run` | O | `--project`; dedicated recurrence worker with startup/30-second ticks, internal fresh revision/epoch reads and deterministic tick IDs |
| `project list` | R | Required scope selection; filters/pagination → project list |
| `project get` | R | `--project` → Project |
| `project create` | M | `--project <new-slug>`, ProjectCreate (slug must match); no old revision → Project with default or supplied config |
| `project update` | M | ProjectPatch → Project |
| `project archive` | M | `{affected_tasks:[{task_id,expected_revision}]}` → Project; reconcile owed anchors and validate every child lifecycle/revision |
| `project restore` | M | `{affected_tasks:[{task_id,expected_revision}]}` → Project; formerly active recurring children become paused, other children retain state |
| `config presets` | R | Explicit read scope → built-in ordinary/recurring workflows and priority presets |
| `config get` | R | `--project` → complete config and revision |
| `config preview` | R | Proposed ConfigMigration → affected task revisions and required mappings/issues |
| `config migrate` | M | Complete ConfigMigration → new config and changed task IDs/revisions |
| `task list` | R | Scope and filters → paginated Task summaries |
| `task get <task-id>` | R | `--project` → Task detail including raw Markdown, sanitized HTML, dependencies, recurrence summary |
| `task create` | M | TaskCreate → Task; config revision required, no old task revision |
| `task update <task-id>` | M | TaskPatch → Task |
| `task transition <task-id>` | M | TaskTransition → Task; supplied confirmation is audited |
| `task archive <task-id>` | M | Empty payload, optional configured transition confirmation for recurring → Task |
| `task restore <task-id>` | M | TaskRestore with configured recurring confirmation → Task; recurring restored to paused category |
| `description preview` | R | `--project`, `{description}` → `{rendered_html}` from the shared renderer; no task save |
| `dependency list <task-id>` | R | `--project` → links including prerequisite project and satisfaction |
| `dependency add <task-id>` | M | Dependency mutation payload; expected parent task revision → updated task and links |
| `dependency remove <task-id>` | M | Same endpoint identifiers/revision → updated task and links |
| `recurrence get <task-id>` | R | `--project` → settings, lifecycle category, derived deadline, pending/debt counts |
| `recurrence configure <task-id>` | M | RecurrenceInput, expected parent revision → revised future schedule |
| `recurrence control <task-id>` | M | `{to_status_id,confirmation?,first_deadline?}` → parent/recurrence; lifecycle category supplies activate/pause/resume behavior |
| `recurrence tick` | M | `--project`, `{tasks:[{task_id,expected_revision}],expected_config_revision}` → generated/expired occurrence IDs and updated revisions; server clock only |
| `occurrence list <task-id>` | R | `--project`, `--state` optional, pagination → occurrence list |
| `occurrence get <task-id> <occurrence-id>` | R | `--project` → occurrence with description/settings snapshot |
| `occurrence complete <task-id>` | M | Explicit occurrence IDs/revisions and optional per-row actual times; expected parent revision → selected occurrences and parent revision |
| `occurrence cancel <task-id>` | M | Explicit occurrence IDs/revisions plus reason; expected parent revision → cancelled rows and parent revision |
| `agenda` | R | Scope/filters/pagination → project/agenda groups containing Task summaries |
| `priorities` | R | Scope/filters/pagination → project/priority groups containing Task summaries |
| `stats` | R | Scope/filters → separate task and occurrence counters |
| `audit list` | R | Scope, `--entity-id`, `--operation`, pagination → Audit list with before/after and confirmations |
| `settings get` | R | `--project` attribution context or `--all-projects` → Settings |
| `settings update` | M | `--project`, `{timezone}`, settings revision + config revision → Settings |
| `backup list` | R | `--all-projects` → managed Backup list |
| `backup create` | O | `--project`, empty payload, current settings revision + config revision → Backup manifest; domain DB read-only |
| `backup validate <backup-id>` | R | `--all-projects` → integrity/compatibility and exact affected-project union; conflicts return structured EMOJI_CONFLICT per common contract |
| `backup restore` | O | `--project`, `{backup_id,affected_projects,confirmation}`, current settings revision + config revision → restore job/result, new epoch on success |
| `backup status [job-id]` | R | `--all-projects`, either job ID or `--operation-id` lookup → maintenance-safe job status/result |

Config creation occurs with project creation; all subsequent changes use `config migrate`,
including changes that need no mappings. There is no separate destructive replacement
command. Manual backup commands use managed snapshot IDs, so the Web UI and CLI can manage
the same snapshots. Restore's allowlist and receipt-status recovery are in the common
contract. CLI restore waits for completion by default, with bounded status reporting to
stderr only in human mode; `--no-wait` returns the job receipt for later status queries.
An old-epoch restore retry is rejected after success; use `backup status --operation-id`
to retrieve its external receipt if the job ID was lost. `serve`/`worker run` in JSON mode
emit one startup readiness envelope, then remain running; shutdown exits 0, failures write
structured errors to stderr and exit nonzero. Readiness is not a claim that a later process
failure cannot occur. Worker commands acquire fresh preconditions internally for every
deterministic mutation, name one project, and record `origin:"recurrence-worker"`.

## Agent workflow and conflicts

1. Read `meta --all-projects --json`, then the project config and task in explicit scope.
2. Keep epoch/revisions and the proposed JSON file. Obtain external user confirmation when
   the selected edge requires it; record the actual confirmation text in that payload.
3. Choose one UUID operation ID. Submit with project scope and required revisions.
4. If the response is lost, retry the exact same command and input, including operation ID.
5. On revision/config/epoch conflict, read current state, revise the proposal, and use a new
   operation ID. Never silently overwrite, automatically merge, or remove required guards.

Read-only status/help processes do not need a database mutation envelope. Native SQLite
access failures and backup failures are errors, not empty lists. Lock timeout is
`DB_CONFLICT`, and maintenance status remains readable while restore closes database
connections. Application commands acquire the documented shared external lock before
opening a database connection; they never bypass the restore helper's exclusive lock.

## Required contract validation

Use subprocess tests of the compiled entry for valid reads/writes and malformed arguments,
not just calls into CLI functions. Assert one JSON document on the correct stream, exit
codes, noninteractive EOF behavior, UTF-8/emoji/Markdown round-trip, stdin/file equivalence,
unknown-field rejection, explicit scope, and no environment-dependent locale/date sorting.
Compare equivalent CLI and HTTP operations against migrated temporary SQLite databases.
Inject domain time in test fixtures; production CLI exposes no `--now` override.
