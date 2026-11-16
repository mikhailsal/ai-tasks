# Research: Reasons and notes on occurrence outcomes

**Feature**: `007-occurrence-reasons-and-notes` | **Date**: 2026-11-16

Checked against commit `bf8bd62`. Owner decisions of 2026-11-16 (Clarifications): FR-003
option (a); the 11 Nov archive case belongs here (FR-011).

## R1. Storage

- **Decision**: Migration `drizzle/0004_occurrence_reasons.sql` adds three nullable columns to
  `occurrences` with column CHECK constraints, following the `ALTER TABLE ... ADD ... CONSTRAINT
  ... CHECK` pattern of `drizzle/0002_ordinary_completion_time.sql`:
  `miss_reason TEXT`, `miss_reason_recorded_at INTEGER`, `completion_note TEXT`.
  Rules: `miss_reason` set only in states `missed` and `completed_late`, together with
  `miss_reason_recorded_at`, non-empty after trim, at most 500 characters; `completion_note` set
  only in `completed` and `completed_late`, same text rules. Existing rows get NULL.
- **Rationale**: the existing table encodes outcome rules as CHECK constraints
  (`src/schema/recurrence.ts:146-161`); the new rules belong there too. `missed_at` keeps meaning
  "when the occurrence was missed"; the new timestamp records when the reason or the decision was
  written, so a declined debt keeps its original miss time (FR-003, FR-006).
- **Alternatives**: a separate outcome-history table (the audit log already keeps every
  transition through `occurrenceEvent`, `src/core/recurrence/snapshots.ts:50-75`).

## R2. Recording a miss (FR-001, FR-003, FR-008)

- **Decision**: New mutation `occurrence miss <task-id>`, flat input
  `{occurrences:[{id, expected_revision}], reason?}`, guards `entity` + `settings` like
  `occurrence complete`. Allowed per selected row:
  - `pending` with window open → `missed`, `missed_at = now`, reason optional except on
    carry-forward occurrences, where it is required;
  - `missed` without reason → reason added, state unchanged;
  - `debt` → `missed` with required reason, `missed_at` unchanged;
  - anything else (`completed`, `completed_late`, `cancelled`, `missed` with a reason) →
    refused with the current state and next step (FR-007), using 004's blocker shape for
    multi-row requests.
  Each selected row first goes through `expireOccurrence` (`src/core/recurrence/expire.ts:23-28`),
  exactly as `completeSelected` does today. A `pending` row past its window therefore becomes
  `debt` or `missed` (with `missed_at = expires_at`) inside the same transaction and the rules
  above apply to that state. This matters when the worker is stopped: the row is still `pending`
  in storage although its window has closed (review 2026-11-16, finding E1).
  Exact retries use the existing receipt replay (`src/core/audit/receipts.ts:76-106`): the same
  `operation_id` and body return the stored envelope with its original `operation_id` and
  `audit_ids`, which is how a client sees that nothing new was written (FR-008). The agent guide
  states this.
- **Rationale**: a batch reason matches `occurrence cancel` (`cancelOccurrencesSchema`); expiry
  only processes `pending` rows, so a `missed` row can never become `debt` again (FR-003).
- **Alternatives**: a reason per item (no reported need; can be added later without breaking).

## R3. Note on completion (FR-002)

- **Decision**: `occurrence complete` items accept optional `note`. Stored in `completion_note`.
- **Rationale**: completion items are already per occurrence (`actual_completed_at`).

## R4. Output and compatibility (FR-005, FR-010, SC-003)

- **Decision**: `occurrenceResourceSchema` (strict, `src/schema/recurrence-query.ts:30`) gains
  optional `miss_reason`, `miss_reason_recorded_at`, `completion_note`, emitted only when set.
  Requests that do not use the new inputs therefore return byte-identical responses (SC-003).
  A reason recorded by one client is visible to all; a third-party client that rejects unknown
  keys must update, which is announced in the change log and compatibility notes, the same
  policy the owner chose for advisories on 2026-11-16 (specification 010, FR-009 = B). The web
  client shares the schema and is updated in the same change.
- **Implementation note**: `occurrenceEvent` diffs resource objects and parses missing previous
  keys with `jsonValueSchema`; absent keys must be compared as `null` so the first reason does
  not throw.

## R5. Archiving with old debt (FR-011, SC-004)

- **Decision**: no change to the archive rule: `assertRetirable` blocks only `pending` and
  `debt` (`src/core/recurrence/retirement.ts:92`). Closing the debt as missed removes the
  blocker. The 004 owed blocker gains the hint `close_as_missed` (contract in 004).
- **Rationale**: the 2026-11-16 probe showed the only blockers left after pause and cancel are
  owed rows.

## R6. Web and human output (FR-005, US4)

- **Decision**: the occurrence row shows «Причина пропуска: …» and «Заметка: …» next to the
  outcome, like the existing «Причина отмены» (`web/src/screens/occurrence-row.tsx:75`); the
  CLI human list appends the text after the state. Text is rendered as plain text (React text
  nodes), never as HTML.

## R7. Rule change versus specification 001

- **Decision**: 001's statement "owed work cannot be cancelled" stays true; owed work may now
  also leave `debt` by being closed as missed with a reason. `contracts/common.md` recurrence
  section and the agent guide are updated in the same change.
