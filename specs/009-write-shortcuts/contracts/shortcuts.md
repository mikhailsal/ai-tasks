# Contract: write shortcuts (CLI)

**Feature**: `009-write-shortcuts` | **Date**: 2026-11-16

## `occurrence done <task> --project SLUG (--day YYYY-MM-DD | --occurrence ID) [--at TIMESTAMP] [--note TEXT] --json`

Equivalent strict write: `occurrence complete <task-id>` with one item. The application has
no generic `NOT_FOUND` code; a missing task or occurrence is `TASK_NOT_FOUND` (exit 3).

| Case | Result |
|---|---|
| One match, open, owed or missed | success, strict envelope |
| Already completed, same data | success, `data.existing: true`, no write |
| Already completed, different data | `VALIDATION_ERROR` exit 2, `details.existing` |
| No match | `TASK_NOT_FOUND` exit 3, `details.nearest_days` `{earlier, later}` (each a day or null) |
| Several matches | `VALIDATION_ERROR` exit 2, `details.candidates[]` `{id, state, deadline}` |
| Unknown or default icon | `TASK_NOT_FOUND` exit 3 / `VALIDATION_ERROR` exit 2 with `details.allowed` icons |
| Ordinary task | `VALIDATION_ERROR`, task kind named |

## `task move <task> --project SLUG --to STATUS [--from STATUS] [--confirmation JSON] --json`

Equivalent strict write: `task transition <task-id>`.

| Case | Result |
|---|---|
| Allowed | success, strict envelope |
| Already in target | success, `data.existing: true`, no write |
| `--from` differs | `VALIDATION_ERROR`, `details.actual_status` |
| Not allowed from current | existing transition refusal + `details.allowed` |
| Confirmation needed | existing refusal of the strict form |

Both: no `operation_id`, `database_epoch` or `expected_*` input accepted; project mismatch,
archived and paused rules as in the strict form.
