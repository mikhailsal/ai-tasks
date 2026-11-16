# Research: Late-recording label

**Feature**: `006-late-recording-label` | **Date**: 2026-11-16

Inventory taken on 2026-11-16 with a search of `web/src`, `src/cli`, `docs`, `README.md`,
`specs/001-ai-task-manager` and `tests` for the state and its Russian wording.

## R1. Where people see the state

- **Decision**: Two sources of wording exist and both change:
  - `web/src/screens/occurrence-model.ts:61` (`occurrenceLabels.completed_late`,
    «Выполнено поздно»), used by `Occurrences.tsx`, `workload-counters.tsx` and
    `occurrence-row.tsx`, so rows, filters and counts follow from one table;
  - `src/cli/command-helpers.ts:151`, human summary line («поздние N»).
  The new wording is «Записано после окна» (spec assumption; owner may adjust at review). The
  CLI summary uses «записаны после окна N».
- **Rationale**: one table in the web client already feeds every web place (FR-002), so the
  change is two strings plus their checks.
- **Alternatives**: a shared label module for CLI and web (the CLI summary is a sentence, not a
  label; sharing would couple the CLI bundle to web code for one word).

## R2. Checks that quote the old wording

- **Decision**: `tests/e2e/read-views.spec.ts:214` expects «Выполнено поздно: 1»; it is updated
  in the same change. A new unit test asserts the label table and the CLI summary, and a search
  test fails if the old wording appears in `web/src`, `src`, `docs` or `README.md` (SC-001).
- **Rationale**: SC-001 counts zero remaining occurrences; a search test keeps it at zero.

## R3. Documentation

- **Decision**: `specs/001-ai-task-manager/contracts/common.md:194` gains one sentence: the state
  means the completion was recorded after the confirmation window; `actual_completed_at` is
  stored separately and is not judged. The agent guide from 004 gets the same sentence and a
  CHANGELOG entry notes the wording change and that the state value is unchanged.
- **Rationale**: FR-005; no document quotes the old Russian wording today (search on
  2026-11-16 found it only in code and the e2e test).

## R4. Machine-readable output

- **Decision**: no change to `src/schema/*`, core, JSON output or the database. The existing
  contract tests are the proof (SC-002).
