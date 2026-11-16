# Implementation Plan: Late-recording label

**Feature**: `006-late-recording-label` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `006-late-recording-label`, created when implementation is approved. Planned on
`ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: `specs/006-late-recording-label/spec.md`; constitution v3.2.0; owner approval of
T11 on 2026-11-09.

## Summary

Change the text people see for `completed_late` from «Выполнено поздно» to «Записано после
окна» in the one web label table and the one CLI summary line, update the e2e check that
quotes it, and document the meaning. No schema, core, JSON or stored-data change.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: React web client, commander CLI (existing); none added

**Storage**: unchanged

**Testing**: Vitest unit (label table, CLI summary, old-wording search); Playwright
`read-views.spec.ts` (Chromium and WebKit); existing contract tests for SC-002

**Target Platform**: mobile web UI and CLI human mode

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: none; bundle size change is a few bytes

**Constraints**: JSON output byte-identical (FR-004)

**Scale/Scope**: 2 source strings, 1 e2e assertion, 2 documents, 1 change-log entry

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | No domain change | Text only in web and CLI adapters | Review |
| II. Isolation and audit | None | No mutation | N/A, recorded |
| III. CLI contract | JSON unchanged; human text may change | Only the human summary line | Existing compiled-CLI contract tests green |
| IV. Mobile and offline | Layout and offline behavior unchanged | Same component, longer text; checked at 430 px | `read-views.spec.ts` at mobile width |
| V. Types and boundaries | Label table stays typed by the state enum | `Record<OccurrenceResource['state'], string>` kept | Typecheck |
| VI. Behavior tests | Proportional | Unit + e2e listed below; regression first: the e2e assertion is changed first and fails until the label changes | `npm run test:functional`, `npm run test:e2e` |
| VII. Bundle | Under 150,000 gzip bytes | Few bytes | `npm run check:bundle-size` at acceptance |
| Compatibility | Docs in same change | common.md, agent guide, CHANGELOG | Review |
| Quality gates (owner rule) | Existing gates | No change | CI, pre-push |

## Project Structure

```text
specs/006-late-recording-label/  plan.md research.md data-model.md quickstart.md contracts/wording.md
web/src/screens/occurrence-model.ts     # label text
src/cli/command-helpers.ts              # summary line text
tests/e2e/read-views.spec.ts            # updated expectation
tests/unit/occurrence-wording.test.ts   # NEW: label, summary, old-wording search
specs/001-ai-task-manager/contracts/common.md, docs/agent-guide.md (from 004), CHANGELOG.md
```

**Structure Decision**: existing files only, plus one unit test.

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1/3, FR-001, FR-002 | Row, filter and count show the new label | Playwright `read-views.spec.ts`, Chromium + WebKit |
| US1-2, FR-002 | Human `stats` summary uses the new words | Unit on the summary formatter |
| US1-4, FR-003 | Details still show both times | Existing e2e assertion kept |
| US2-1, FR-004, SC-002 | JSON unchanged | Existing contract suites |
| FR-005, SC-001 | Old wording absent from code and docs | Unit search test |
| SC-003 | No text claims when work was done | Review of the contract table |

Mutation coverage N/A: no mutation. Contention N/A.

## Migration and recovery

None. Revert restores the old text.

## Dependencies

Independent. If 004 has shipped, its agent guide gets the meaning sentence; otherwise the
sentence goes into `contracts/common.md` only and 004 picks it up.

## Complexity Tracking

No exceptions.
