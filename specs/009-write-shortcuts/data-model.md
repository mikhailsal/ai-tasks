# Data Model: Write shortcuts

**Feature**: `009-write-shortcuts` | **Date**: 2026-11-16

No stored data changes. Shortcuts produce the same rows, receipts and audit events as the
strict writes `occurrence complete` and `task transition`.

| Entity | Content |
|---|---|
| Task name | UUID, or a non-default icon reserved in the project |
| Day | `YYYY-MM-DD`, matched to `occurrence_day` (008) or the local deadline date before 008 |
| Candidate | `{id, state, deadline}` of an occurrence matching task and day |
| Existing marker | `data.existing: true` on a no-op repeat |
