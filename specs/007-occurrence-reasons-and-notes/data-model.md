# Data Model: Reasons and notes on occurrence outcomes

**Feature**: `007-occurrence-reasons-and-notes` | **Date**: 2026-11-16

## Occurrence (changed table `occurrences`)

| New column | Type | Rule |
|---|---|---|
| `miss_reason` | TEXT NULL | Only in `missed`, `completed_late`; trimmed non-empty; at most 500 characters; stored as typed. |
| `miss_reason_recorded_at` | INTEGER NULL | Set exactly when `miss_reason` is set; integer milliseconds. |
| `completion_note` | TEXT NULL | Only in `completed`, `completed_late`; same text rules. |

Unchanged: `state`, `missed_at`, `actual_completed_at`, `completion_recorded_at`,
`cancelled_at`, `cancel_reason` and all existing constraints.

## State transitions added

| From | Action | To | Fields written |
|---|---|---|---|
| `pending` (window open) | miss | `missed` | `missed_at = now`; reason and its time if given (required on carry-forward) |
| `missed` (no reason) | miss with reason | `missed` | reason and its time |
| `debt` | miss with reason | `missed` | reason and its time; `missed_at` kept |
| `pending`, `missed`, `debt` | complete with note | `completed` / `completed_late` | `completion_note` (existing completion fields as today) |

A `missed` row keeps its reason after a later completion (`completed_late`), so the history
shows both (FR-006). Every transition is audited through the existing occurrence event.

## Migration

`0004_occurrence_reasons.sql`: three `ALTER TABLE occurrences ADD` statements with CHECK
constraints; no data rewrite; existing rows valid with NULLs. Tested by upgrading a populated
schema-3 database (constitution, Compatibility).
