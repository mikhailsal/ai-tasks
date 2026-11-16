# Contract: occurrence miss, notes and reasons

**Feature**: `007-occurrence-reasons-and-notes` | **Date**: 2026-11-16

Additions to [cli.md](../../001-ai-task-manager/contracts/cli.md),
[http.md](../../001-ai-task-manager/contracts/http.md) and
[common.md](../../001-ai-task-manager/contracts/common.md).

## New command

| CLI | HTTP | Kind | Input |
|---|---|---|---|
| `occurrence miss <task-id>` | `POST /api/projects/:project_slug/tasks/:task_id/occurrences/miss` | M | `{occurrences:[{id,expected_revision}], reason?}` plus the tokens of `occurrence complete` (`operation_id`, `database_epoch`, `expected_revision`, `expected_config_revision`, `expected_settings_revision`) |

Result: same shape as `occurrence complete` (`{task_id, task_revision, occurrences:[...]}`).

## Changed input

`occurrence complete` items accept optional `note` (string).

## Text rules (FR-004)

`reason` and `note`: well-formed Unicode, non-empty after trimming, at most 500 characters,
plain text. Violations: `VALIDATION_ERROR`, exit 2, issue naming the field and the rule.

## Refusals (FR-007)

`VALIDATION_ERROR` with 004's `blockers[]` per row: `already_completed`, `cancelled`,
`reason_exists`, `reason_required` (debt or carry-forward without reason). Each names the current state and the
next step.

## Output (FR-005, FR-010)

`OccurrenceResource` gains optional `miss_reason`, `miss_reason_recorded_at`,
`completion_note`, present only when set. Responses for occurrences without them are unchanged.
Announced in the change log as an addition that clients rejecting unknown keys must accept.
