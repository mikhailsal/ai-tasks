# Contract: occurrence day, recorded values, progress

**Feature**: `008-occurrence-day-and-goal-progress` | **Date**: 2026-11-16

## Changed

| Command / route | Change |
|---|---|
| `project update` / `PATCH /api/projects/:slug` | optional `day_start_hour` (0..23); project resource shows it when non-zero |
| `recurrence configure` | optional `values: [{name, kind}]`; `[]` clears |
| `occurrence complete` | items accept optional `values: {name: value}` |
| `occurrence list` / `GET .../occurrences` | optional `day`, or `from_day` and `to_day` |
| Occurrence resource | `occurrence_day` (always), `recorded_values` (when set) |

## New

| CLI | HTTP | Input | Result |
|---|---|---|---|
| `occurrence progress <task-id>` | `GET /api/projects/:slug/tasks/:task_id/occurrences/progress` | `from_day`, `to_day` (inclusive, at most 366 days) | `{task_id, from_day, to_day, done, decided, open, breakdown:{completed, completed_late, missed, debt}}` |

## Refusals

- Undeclared value name: `VALIDATION_ERROR`, `details.allowed` lists declared names and kinds.
- Wrong kind: `VALIDATION_ERROR`, issue names the field and expected kind.
- Window longer than 366 days or `from_day` after `to_day`: `VALIDATION_ERROR`.
- Progress for an ordinary task: `VALIDATION_ERROR` naming the task kind.

## Example

Window of 7 days, 5 completed, 1 completed_late, 1 missed:
`{"done":6,"decided":7,"open":0,"breakdown":{"completed":5,"completed_late":1,"missed":1,"debt":0}}`.
