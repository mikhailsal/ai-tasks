# Data Model: Agent-ready diagnostics and onboarding

**Feature**: `004-agent-diagnostics-onboarding` | **Date**: 2026-11-16

No stored data changes: no table, column, migration or audit record is added or altered.
The entities below are shapes inside the existing `error.details` JSON value of the error
envelope. All are additive; keys that exist today keep their names and meanings
([contracts/diagnostics.md](contracts/diagnostics.md) lists them per refusal).

## Hint

A corrective next step.

| Field | Type | Rule |
|---|---|---|
| `action` | string | Stable identifier from a closed list (for example `choose_scope`, `read_revision`, `pause_parent`, `cancel_future`, `complete_occurrence`, `run_tick`, `run_migration`, `read_allowed_values`). Documented in the agent guide. |
| `text` | string | English, at most 200 characters, no request values. |
| `command` | string, optional | Name of the command that supplies a value or performs the step, without arguments (for example `config get`). |
| `field` | string, optional | Name of the input field the hint refers to. |

## MissingValue (FR-007)

| Field | Type | Rule |
|---|---|---|
| `field` | string | `operation_id`, `database_epoch`, `expected_revision`, `expected_config_revision`, `expected_settings_revision`, or `occurrences[i].expected_revision`. |
| `source` | Hint | Where to read the value. |

Listed once per field, in the order of the guard declaration. `details.field` (existing) equals
the first entry.

## IssueDetail (FR-005, FR-006, FR-008)

Existing `{code, path}` plus, depending on `code`:

| Field | When | Content |
|---|---|---|
| `expected` | `invalid_type` | Expected type name from the schema. |
| `allowed`, `allowed_omitted` | `invalid_value` with a fixed set | Schema literals, at most 20. |
| `source` | value set depends on configuration | Hint naming the command that lists the values. |
| `keys`, `keys_omitted` | `unrecognized_keys` | Safe-form names (research R2), at most 10. |
| `minimum` / `maximum` | `too_small` / `too_big` | Schema bound. |
| `alternatives` | `invalid_union` | One `{expected}` or `{discriminator, allowed}` per branch. |

## Blocker (FR-012, FR-015, FR-023)

| Field | Type | Rule |
|---|---|---|
| `reason` | string | `owed_anchors`, `parent_not_paused`, `future_pending`, `past_pending`, `owed`, `not_pending`. |
| `count` | integer | Number of occurrences (or anchors) concerned. |
| `occurrence_ids` | uuid[] | At most 10; `omitted` gives the rest. |
| `step` | Hint | The next step for this blocker. |

Blockers are ordered by the order in which the steps must be taken: tick, pause, cancel future,
resolve past pending, resolve owed.

## Bounds (FR-021)

`issues` 10, `hints` 10, `blockers` 10, `occurrence_ids` 10, `allowed` 20, repeated names 10 of
at most 64 characters. A cut list is accompanied by an integer `<list>_omitted` (or `omitted`
inside a blocker).
