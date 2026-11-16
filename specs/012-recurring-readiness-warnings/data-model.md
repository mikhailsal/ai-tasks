# Data Model: Recurring readiness warnings

**Feature**: `012-recurring-readiness-warnings` | **Date**: 2026-11-16

No stored data changes. The stored schedule keeps a required `local_time`; only the input makes
it optional.

## Advisory codes (010 catalogue)

| Code | Raised when | Not raised when | Remedy |
|---|---|---|---|
| `recurring_not_generating` | status category `draft` | paused, archived, terminal; active | transition to an active-category status (ids listed) |
| `schedule_time_derived` | create or configure response where `local_time` was omitted | any read | none needed; states the derived time |
| `schedule_time_mismatch` | both given and differ, until the first occurrence is decided | equal or only one given | review the two times; later occurrences use `local_time` |
