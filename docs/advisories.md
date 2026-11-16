# Advisories

An advisory is a short, non-fatal note on a successful response (spec 010). It never changes
`ok`, `data`, `meta`, the exit status or stored data. It is computed from current state on every
response, so it stays while its condition holds and disappears when the condition is gone.

```json
{
  "ok": true,
  "data": {},
  "meta": {},
  "advisories": [
    {
      "code": "recurring_not_generating",
      "message": "...",
      "remedy": {
        "action": "transition_task",
        "command": "task transition",
        "text": "Move it to an active status: active."
      },
      "subject": { "type": "task", "id": "..." }
    }
  ],
  "advisories_omitted": 2
}
```

- `advisories` is present only when at least one applies; at most 10 per response, in
  catalogue order, then by subject id. `advisories_omitted` says how many were cut.
- Four or more advisories with the same code in one response are reported once with `count`
  and no `subject`.
- `message` is fixed text from the table below. `remedy` has the shape of the error hints of
  spec 004 (`action`, `text`, optional `command`); its text may show stored values, never
  request values.
- CLI human mode prints `advisory: <code>: <message> (<remedy text>)` on stderr; stdout is
  unchanged. JSON mode and HTTP carry the keys in the envelope. Error envelopes never carry them.

## Catalogue

| Code                       | Message                                                                          | Meaning                                                                                                                       | Spec |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- |
| `worker_stale`             | The recurring worker has not run recently; occurrence lists may be incomplete.   | No worker pass for this project within the tolerance (300 s), and it has an active recurring task.                            | 011  |
| `worker_never_ran`         | The recurring worker has never run for this project; no occurrences are created. | No worker pass was ever recorded for this project, and it has an active recurring task.                                       | 011  |
| `recurring_not_generating` | This recurring task generates no occurrences in its current status.              | The status category is draft, so no occurrence is created.                                                                    | 012  |
| `schedule_time_mismatch`   | The first deadline and the schedule local time differ.                           | Both times were given and differ; later occurrences use the schedule local time. Shown until the first occurrence is decided. | 012  |
| `schedule_time_derived`    | The schedule local time was derived from the first deadline.                     | local_time was omitted in this create or configure request.                                                                   | 012  |
