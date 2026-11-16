# Contract: advisories on success responses

**Feature**: `010-advisory-warnings` | **Date**: 2026-11-16

Extends the success envelope of [common.md](../../001-ai-task-manager/contracts/common.md).

```json
{"ok":true,"data":{...},"meta":{...},
 "advisories":[{"code":"recurring_draft_no_occurrences","message":"This recurring task is a draft and generates no occurrences.","remedy":{"action":"run","command":"recurrence control","text":"Activate the task when it is ready."},"subject":{"type":"task","id":"..."}}]}
```

The code in the example belongs to specification 012 and is illustrative.

Rules:

- Present only when a condition applies; absent otherwise (byte-identical to today).
- Never on error envelopes; never changes `ok`, `data`, `meta` or the exit status.
- At most 10, stable order, `advisories_omitted` when cut.
- Human mode: one stderr line per advisory; stdout unchanged.
- HTTP: same envelope keys.
- Every code is in `docs/advisories.md`.

Compatibility: announced change (owner decision B, 2026-11-16). Clients that reject unknown
top-level keys must accept `advisories` and `advisories_omitted`.
