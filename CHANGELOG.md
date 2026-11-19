# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Web, new project: the slug is suggested from the name (Russian letters transliterated, for
  example «Щука и ёж» → `shchuka-i-ezh`) and follows the name until you type your own. The
  link is shown under the name, so a Cyrillic name no longer fails on a hidden required slug.
- Web forms: a rejected save names the field and its rule («Проверьте поле «Эмодзи». Нужен
  ровно один эмодзи…») instead of only «Проверьте заполненные поля». The project editor marks
  the rejected field (`aria-invalid` and a message under it) until it is edited, and opens
  «Дополнительные настройки» when the slug or configuration was rejected.

### Agent-visible changes

- An invalid emoji (`VALIDATION_ERROR`, message unchanged) now carries
  `details.issues: [{code: "custom", path: ["emoji"], expected: "exactly one RGI emoji grapheme"}]`
  instead of `details: null`, like other invalid fields.

## [0.2.0] - 2026-11-17

First tagged release. The package was 0.1.0 before, never tagged. Upgrading a 0.1.0 checkout
needs a backup, `npm ci`, `npm run build` and `npm run db:migrate`, which applies migrations
`0004_occurrence_reasons`, `0005_occurrence_day` and `0006_worker_passes`; then restart
`serve` so the server and the workers run the new code.

### Local network access (spec 003)

- `serve` can listen on a LAN address: `AI_TASKS_HOST=<LAN IPv4> npm start` prints the URL
  to open on a phone. The default stays loopback only. See `docs/operations.md`.

### Development: pull requests and pre-push checks

- Changes reach `main` only through pull requests with green CI.
- `npm run hooks:install` installs the committed pre-push hook: runtime check, typecheck,
  lint, format check and ShellCheck; it refuses direct pushes to `main`.

### Agent-visible changes: worker liveness (spec 011)

- `meta` gains `data.workers`: `[{project_slug, status, last_pass_at?, tolerance_seconds}]` for
  every active project; project reads (CLI and HTTP) gain `worker: {status, last_pass_at?}`.
  Status is `healthy`, `stale` (no pass for more than 300 s) or `never`.
- Advisories `worker_stale` and `worker_never_ran` on dependent reads (occurrence list, get and progress; recurrence get; agenda; task list
  and get) of a project with an
  active recurring task; the remedy names `serve` and `worker run --project SLUG`.
- Migration `0006_worker_passes`: one row per project, written by the worker at most once a
  minute, not audited and not counted in `read_revision`.
- The web shows the status on the project list, the project, the task and its occurrences.

### Announced change: advisories on success responses (spec 010)

- Success envelopes may now carry two more top-level keys, `advisories` (at most 10) and
  `advisories_omitted`. They appear only when an advisory applies; every other response is
  byte-identical to before. They never change `ok`, `data`, `meta`, the exit status or stored
  data, and never appear on error envelopes.
- **Who must update**: a client that rejects unknown top-level keys in a success envelope must
  accept these two (or ignore them). The CLI, HTTP API and web client in this repository do.
- CLI human mode prints each advisory as `advisory: <code>: <message> (<remedy>)` on stderr.
- Catalogue: [`docs/advisories.md`](docs/advisories.md). See also `docs/compatibility.md`.

### Agent-visible changes: recurring readiness (spec 012)

- `recurring_not_generating` on create and on every read of a recurring task in a draft-category
  status (task get, list, board, priorities, agenda, recurrence get, transitions); gone once
  active. Paused, archived and waiting tasks raise nothing.
- Calendar schedules accept an omitted `local_time`: it is derived from `first_deadline` in the
  application time zone and stored; the response carries `schedule_time_derived`.
- Both given and different: accepted as before, with `schedule_time_mismatch` until the first
  occurrence is decided. No request accepted before is refused now.

### Agent-visible changes: write shortcuts (spec 009)

- New CLI command `occurrence done <task> (--day YYYY-MM-DD | --occurrence ID) [--at] [--note]`:
  completes one occurrence in one call. The application fills the operation identifier, epoch
  and revisions under its own lock and runs the strict `occurrence complete` handler.
- New CLI command `task move <task> --to STATUS [--from STATUS] [--confirmation JSON]`: the
  strict `task transition` in one call. `--from` refuses without change and names
  `details.actual_status` when the task has moved on.
- `<task>` is a task ID or the task's reserved icon in the project; the default icon ⚪ is
  refused. A repeat with the same data returns `data.existing: true` and writes nothing.
- Refusals name the next step: `details.nearest_days`, `details.candidates`,
  `details.allowed`, `details.existing`. The audit trail equals the strict form's.
- New CLI options: `--occurrence`, `--at`, `--note`, `--to`, `--from`, `--confirmation`.
  HTTP and the web are unchanged: shortcuts are CLI only.

### Agent-visible changes: occurrence day, recorded values, goal progress (spec 008)

- Projects have `day_start_hour` (0..23, default 0), set by `project update`; the project
  resource shows it only when non-zero.
- Occurrences carry `occurrence_day`, stored at creation under the project's rule and never
  recomputed; existing rows are filled with the midnight rule on upgrade. This key is always
  present: clients that reject unknown keys must accept it.
- `occurrence list` (CLI `--day`, `--from-day`, `--to-day`; HTTP `day`, `from_day`, `to_day`)
  filters by day.
- Recurrence input accepts `values` (declared names and kinds); completion items accept
  `values`; occurrence resources show `recorded_values` and the recurrence resource shows
  `values` only when set.
- New read `occurrence progress <task-id>` (HTTP `GET .../occurrences/progress`) with
  `{done, decided, open, breakdown}` over an inclusive window of days. The web occurrence
  screen shows the day, the values, a date filter and the progress block.
- Migration `0005_occurrence_day` plus a backfill step in `migrateDatabase` (also on restore).

### Agent-visible changes: reasons and notes on occurrence outcomes (spec 007)

- New `occurrence miss <task-id>` (HTTP `POST .../occurrences/miss`): record a miss now with an
  optional reason, add a reason to a reasonless miss, or close owed work as missed with a
  required reason. A missed row is never owed again and can still be completed later.
- `occurrence complete` items accept an optional `note`.
- Occurrence resources gain optional `miss_reason`, `miss_reason_recorded_at` and
  `completion_note`, present only when set. Clients that reject unknown keys must accept them.
- The refusal to cancel owed work now names closing it as missed (`close_as_missed`).
- Migration `0004_occurrence_reasons` adds three nullable columns; existing rows are unchanged.

### Wording: completions recorded after the window (spec 006)

- The web label and the human `stats` summary for `completed_late` now read «Записано после
  окна» and «записаны после окна N». The state means the completion was recorded after the
  confirmation window; it says nothing about when the work was done. JSON output, the state
  value and stored data are unchanged.

### Agent-visible changes: self-describing commands (spec 005)

- `help <command words> --json` describes one command: purpose, kind, scope, positional
  arguments, accepted options, input fields (types, required, allowed values, list items,
  union alternatives, where configuration-dependent values are read), revision values with
  the command that supplies each, and a runnable example with placeholder sources.
- `help <family> --json` lists the family's commands; `help --json` keeps `data.help` and
  adds `data.commands`, an index grouped by family.
- An unknown name in `help` is refused with `VALIDATION_ERROR`, `names` and `suggestions`.
- Help never opens the database and returns no `meta`. Human help text is unchanged.
- Missing `expected_revision` on project and configuration changes is now listed with the
  other missing values and names `project get` or `config get` as its source.

### Agent-visible changes: diagnostics and onboarding (spec 004)

Compatibility: error codes, CLI exit statuses, HTTP statuses, `retryable` and all success
envelopes are unchanged. The error object keeps exactly `code`, `message`, `details` and
`retryable`. New content appears only inside `error.details`. A `details` that was `null`
may now be an object. A `details` object keeps every key it had. `message` text changed and
may change again: branch on `error.code`. Tolerate missing new keys. No input became required.
Lists are bounded (10 problems, hints, blockers, names and occurrence ids; 20 allowed values)
and say when they are cut. Responses never repeat request values.

#### Added

- `docs/agent-guide.md`: read scopes, the table of revision values and their sources,
  refusal shapes, hint actions, blocker reasons, a table from common refusals to actions, and
  recipes for the common jobs.
- Closed list of hint actions in `details.hints[]`: `choose_scope`, `read_revision`,
  `read_allowed_values`, `pause_parent`, `cancel_future`, `complete_occurrence`,
  `close_as_missed`, `run_tick`, `run_migration`, `use_supported_option`. Each hint is
  `{action, text, command?, field?}` and the first hint is also in `message`.
- README: one environment block and a first-task path of at most five commands.
- `CLAUDE.md`: quality limits and the commands that check them.

#### Changed

- Read without a scope (CLI and HTTP): `details.hints` names `--project SLUG` and
  `--all-projects` (HTTP: `project_slug` and `all_projects=true`).
- Value outside a fixed set: `details.issues[].allowed` lists the allowed values.
  A configuration-dependent value (for example a status) gets a `read_allowed_values` hint
  naming `config get`.
- Wrong type or shape: `details.issues[].expected`, and `details.issues[].alternatives`
  when several shapes are accepted.
- Missing revision values: one refusal lists all of them in `details.missing[]`, each with
  the command that supplies it. `details.field` is still the first one. Ownership checks and
  replay of a known `operation_id` still come first.
- Unrecognized names: `details.names`, `names_omitted` and `suggestions` (nearest valid names).
  Names are repeated only in a safe form (a-z, digits, underscore, hyphen for command and
  option names; at most 64 characters, at most 10 names). Others are counted, not repeated.
- Unsupported option: `details.option` and `details.supported_options`.
- Cancelling an owed occurrence: the refusal says owed work cannot be cancelled and names the
  real step (`complete_occurrence`). It no longer advises pausing the parent for it.
- Archiving a recurring task: one refusal lists every blocker in step order in
  `details.blockers[]` (`owed_anchors`, `parent_not_paused`, `future_pending`, `past_pending`,
  `owed`, `not_pending`), each with `count`, `occurrence_ids`, `omitted` and `step`.
  The existing keys `reason`, `task_id`, `occurrence_id` and `state` are unchanged.
- Cancelling several occurrences: every occurrence that cannot be cancelled is named with its
  reason and step.
- Timing-mode change refused: `details.blockers[]` says which kind of occurrence blocks it,
  with counts.
- Configuration preview issues: each issue names the mapping position and stored key in
  `message`, exact duplicates are reported once, and the message points to
  `required_status_mappings` or `required_priority_mappings`. The issue shape is unchanged.
- Missing database: `message` explains `AI_TASKS_DB_PATH`, the relative default
  `data/ai-tasks.sqlite`, and `npm run db:migrate`; `details.hints` has `run_migration`.
  Code and exit status (`INTERNAL_ERROR`, 1) are unchanged. No absolute path is shown.

#### Documentation

- Contracts and quickstart no longer contradict each other: a past first deadline is
  accepted, `config migrate` sends the configuration revision twice (`expected_revision` and
  `expected_config_revision`), and mappings for statuses or priorities that no task uses are
  rejected.
