# Contract: recurring readiness

**Feature**: `012-recurring-readiness-warnings` | **Date**: 2026-11-16

## Input change

`task create` (recurring) and `recurrence configure`: in calendar schedules `local_time` is
optional. Omitted → derived from `first_deadline` in the schedule's time zone; the response's
schedule contains the derived value. All requests valid today remain valid with identical
results.

## Advisories

See [data-model.md](../data-model.md). Example create response for a draft:

```json
{"ok":true,"data":{"id":"...","kind":"recurring","status_id":"draft",...},"meta":{...},
 "advisories":[{"code":"recurring_not_generating","message":"This recurring task generates no occurrences in its current status.","remedy":{"action":"run","command":"task transition","text":"Move it to an active status: active."},"subject":{"type":"task","id":"..."}}]}
```

Status ids in the remedy come from the project's workflow; the example is illustrative.
