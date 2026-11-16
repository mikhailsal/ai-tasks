# Contract: worker status

**Feature**: `011-worker-liveness` | **Date**: 2026-11-16

| Surface | Addition |
|---|---|
| `meta --json`, `GET /api/meta` | `data.workers: [{project_slug, status, last_pass_at?, tolerance_seconds}]` |
| `project get/list`, HTTP project resources | `worker: {status, last_pass_at?}` |
| Dependent reads (occurrence list/get, recurrence get, agenda, task list/get) | advisory `worker_stale` or `worker_never_ran` (010) when the project has an active recurring task |

Status values: `healthy`, `stale`, `never`. Tolerance 300 s. Remedy: start the service (`serve`
forks the workers) per the agent guide; `worker run --project SLUG` is the manual alternative.

Example advisory:

```json
{"code":"worker_stale","message":"The recurring worker has not run recently; occurrence lists may be incomplete.","remedy":{"action":"run","command":"serve","text":"Start the service, which runs the worker for this project; last pass 2026-11-15T21:04:00Z."},"subject":{"type":"project","id":"demo"}}
```
