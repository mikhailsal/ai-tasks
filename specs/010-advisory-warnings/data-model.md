# Data Model: Advisory warnings

**Feature**: `010-advisory-warnings` | **Date**: 2026-11-16

No stored data. Response-only entities.

## Advisory

| Field | Type | Rule |
|---|---|---|
| `code` | string | registered in the catalogue; `^[a-z][a-z0-9_]{2,47}$` |
| `message` | string | catalogue text, at most 160 characters, English |
| `remedy` | Hint (004) | `{action, command?, text}` |
| `subject` | `{type, id}` optional | item concerned; omitted for aggregated advisories |
| `count` | integer optional | items affected when aggregated, at least 2 |

## Envelope additions

| Key | Presence |
|---|---|
| `advisories` | only when at least one applies; at most 10 |
| `advisories_omitted` | only when more than 10 applied |

## Catalogue entry (code and docs)

`{code, message, remedy, meaning, owner_spec}`; `docs/advisories.md` mirrors it.
