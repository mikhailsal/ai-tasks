# Contract: diagnostic content of refusals

**Feature**: `004-agent-diagnostics-onboarding` | **Date**: 2026-11-16

Normative in addition to [common.md](../../001-ai-task-manager/contracts/common.md) and
[cli.md](../../001-ai-task-manager/contracts/cli.md). Shapes are defined in
[data-model.md](../data-model.md).

## Invariants (FR-019, FR-020)

- `ok`, `error.code`, `error.retryable`, CLI exit status and HTTP status are unchanged for
  every refusal listed below. Success envelopes are unchanged.
- The top-level error object keeps exactly `code`, `message`, `details`, `retryable`.
- New content appears only inside `details`. A refusal whose `details` is `null` today may
  return an object; a refusal whose `details` is an object keeps every key it has today.
- `message` is English text for people and may change. It includes the first hint.
- No request value is repeated anywhere. Names are repeated only in the safe form of FR-008.
  No stack trace, SQL, storage error, filesystem path other than the documented relative
  default database path, or environment variable value appears.

## Refusals

| Situation (spec) | Code / exit | `details` today | Added to `details` | Message (example) |
|---|---|---|---|---|
| Read without scope, CLI (FR-004) | `VALIDATION_ERROR` / 2 | `{issues}` from Zod | `hints:[choose_scope]` | `Choose a read scope: --project SLUG or --all-projects` |
| Read without scope, HTTP (FR-004) | `VALIDATION_ERROR` / 400 | `{issues}` | `hints:[choose_scope]` naming `project_slug` and `all_projects=true` | `Choose a read scope: project_slug or all_projects=true` |
| Value outside a fixed set (FR-005) | `VALIDATION_ERROR` / 2 | `{issues:[{code,path}]}` | `issues[].allowed` | `Invalid request: priority.level must be one of critical, high, normal, low` |
| Configuration-dependent value (FR-005) | unchanged code | unchanged | `hints:[read_allowed_values]` with `command` | `... Read the allowed statuses with config get` |
| Wrong type or shape (FR-006) | `VALIDATION_ERROR` / 2 | `{issues}` | `issues[].expected`, `issues[].alternatives` | `Invalid request: recurrence.schedule must match one of 4 shapes` |
| Missing revision values (FR-007) | `VALIDATION_ERROR` / 2 | `{field}` | `missing[]` (all of them) | `Missing required values: expected_config_revision (config get), expected_settings_revision (settings get)` |
| Unrecognized names (FR-008, FR-011) | `VALIDATION_ERROR` / 2 | `null` (CLI) or `{issues}` (input) | `names`, `names_omitted`, `suggestions` | `Unknown option --expected-revison. Did you mean --expected-revision?` |
| Unsupported option (FR-010) | `VALIDATION_ERROR` / 2 | `null` | `option`, `supported_options` | `Option --cursor is not supported by task get` |
| Cancel owed occurrence (FR-012) | `VALIDATION_ERROR` / 2 | `null` or `{entity_id}` | `blockers[]` | `Owed occurrences cannot be cancelled. Complete them instead` |
| Configuration preview issues (FR-013) | preview success, `issues[]` | `{code,message,task_id?}` per issue (strict) | nothing: shape unchanged; mapping position and stored key named in `message`; exact duplicates removed | `status_mappings[2] (ordinary:planning): no task uses this status; see required_status_mappings` |
| Database missing (FR-014) | `INTERNAL_ERROR` / 1 | `null` | `hints:[run_migration]` | `Database not found. Set AI_TASKS_DB_PATH (default data/ai-tasks.sqlite in the working directory) and run npm run db:migrate` |
| Timing-mode change refused (FR-015) | `VALIDATION_ERROR` / 2 | `null` | `blockers[]` with counts | `A timing-mode change needs no open occurrences: 1 future pending, 1 owed` |
| Archive recurring task refused (FR-023) | `VALIDATION_ERROR` / 2 | `{reason,task_id,occurrence_id,state}` | `blockers[]` in step order | `Archive is blocked: pause the task, cancel 1 future occurrence, resolve 1 owed occurrence` |
| Cancel several occurrences refused (FR-023) | `VALIDATION_ERROR` / 2 | `{entity_id}` or `null` | `blockers[]` per reason | `2 of 3 occurrences cannot be cancelled: 1 owed, 1 past pending` |

`details.entity_id`, `details.occurrence_id`, `details.field` and similar existing keys keep
describing the first problem, as today.

## Owed-occurrence step and specification 007

Until specification 007 ships, the `step` for an owed occurrence is `complete_occurrence`.
When 007 ships, the same blocker adds a second hint `close_as_missed` (007 FR-009). The
`reason` value `owed` does not change.

## Human-readable mode

Refusals are JSON on stderr in both modes (cli.md, Invocation). The added hint text is part
of `message`, so human readers see it without parsing `details`.
