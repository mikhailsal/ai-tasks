# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
