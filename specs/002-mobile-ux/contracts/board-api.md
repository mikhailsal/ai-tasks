# Shared board order and deadline reads

This additive contract supplements feature 001 HTTP/CLI contracts. The application database is the authority for positions; browser storage caches reads and local drafts only.

## Read one column

`GET /api/v1/projects/:project_slug/board?kind=ordinary&status_id=ideas`

CLI: `task board --project <slug> --kind ordinary --status <id> --json`.

Project, kind and a configured status ID are required. Existing task filters, explicit archive/terminal policy, `limit` (1–200, default 50), cursor, literal title/description `q`, priority JSON, and the deadline inputs below apply before pagination. Response uses the normal success metadata and `data: {items, next_cursor, order_revision}`. Items follow shared board position, then creation time and ID for deterministic fallback. Ordinary list/agenda/priorities keep their existing ordering. Read work is bounded by page size and uses batched resource/dependency hydration.

## Position or transfer a task

`POST /api/v1/projects/:project_slug/tasks/:task_id/position`

CLI: `task position <task-id> --project <slug> --json --input -` using the existing flat CLI mutation input/guard format.

The standard mutation envelope requires operation ID, database epoch, expected task revision and expected project configuration revision. Recurring moves retain the expected settings revision guard. Payload:

```json
{
  "to_status_id": "planning",
  "before_task_id": null,
  "expected_source_order_revision": 4,
  "expected_destination_order_revision": 2
}
```

`before_task_id` selects a known task in the same destination project/kind/status; null means append. Same-column moves do not accept transition-only confirmation/emoji controls. Cross-column moves accept the existing transition confirmation and emoji collision/replacement fields only under their existing rules. The UI loads source/destination completely and disables drag under search/filters, rather than infer hidden membership.

Task ownership, epoch, task/config/settings guards, both column order revisions, destination anchor and lifecycle constraints are checked inside one immediate transaction. It commits task state, affected column revisions/positions, immutable audit events and operation receipt together. Source archival remains read-only. Entries into an archived recurring destination still receive a real position and advance that destination revision. No partial move or success audit survives rejection. A stale version/order returns `REVISION_CONFLICT`; no silent new operation is attempted. An uncertain acknowledgement retains the exact proposal for idempotent replay.

## Deadline inputs

Task-list, board, agenda and priority reads accept optional `deadline_preset` or `deadline_day`, never both. CLI flags are `--deadline-preset` and `--deadline-day`; existing JSON read input also accepts these fields. No parameter preserves previous behavior. Statistics keep their existing separate from/to contract.

- `overdue`: effective deadline before captured `as_of`, ordinary unfinished stages or a recurring open occurrence.
- `today`: local midnight through the next local midnight.
- `from_tomorrow`: next local midnight onward.
- `next_3_days`: today's local midnight through midnight three calendar days later.
- `undated`: no effective deadline.
- `deadline_day=YYYY-MM-DD`: exactly that local calendar day; invalid calendar dates are rejected.

Use application timezone and the cursor's captured reference time across paging. Calendar days follow daylight-saving transitions, not fixed 24-hour intervals. Recurring effective deadlines use the earliest pending/debt occurrence. Deadline, priority, text, kind, status and project filters compose with AND; filter identity participates in cursor validation. Clicking a deadline tag uses its exact day, never a broader from-tomorrow preset.

## Storage and recovery

Migration `0003_shared_board_order.sql` adds `board_order` and `board_columns`, seeds deterministic positions for populated prior databases including archived tasks, and preserves existing tasks/audits/receipts. New tasks and non-positioned lifecycle entries append; board drag inserts before the selected anchor. Per-column position index covers scope/ordering operations. Backup captures both tables; old restored snapshots run migrations before publication. Existing database epochs, read revisions and cursor invalidation remain authoritative.
