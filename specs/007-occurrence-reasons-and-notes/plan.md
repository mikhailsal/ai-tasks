# Implementation Plan: Reasons and notes on occurrence outcomes

**Feature**: `007-occurrence-reasons-and-notes` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `007-occurrence-reasons-and-notes`, created when implementation is approved; after
006 (label wording) and preferably after 004 (blocker shape). Planned on `ci-pr-rule-and-hooks`
at `bf8bd62` without code changes.

**Input**: `specs/007-occurrence-reasons-and-notes/spec.md` (clarified 2026-11-16: FR-003 = a);
constitution v3.2.0.

## Summary

Add three nullable columns to `occurrences` (miss reason, its recording time, completion note)
with CHECK constraints, a new `occurrence miss` mutation that records a miss now, adds a reason
to an existing miss, or closes an owed occurrence as missed with a required reason, and an
optional `note` on completion. Reasons and notes appear in JSON only when set, and in the web
and human output next to the outcome. Archiving a retired schedule with old debt becomes
possible without a false completion.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: Drizzle, better-sqlite3, Zod 4.6.7, Fastify 5, commander 15, React
(existing); none added

**Storage**: SQLite; migration `0004_occurrence_reasons.sql` (additive columns)

**Testing**: Vitest unit and integration on real temporary databases; populated-schema upgrade
test; compiled-CLI and `fastify.inject()` contracts; Playwright for web display

**Target Platform**: Linux host; CLI for agents, mobile web for the owner

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: miss and complete stay within existing mutation budgets; no new query
shape on reads

**Constraints**: SC-003 (no change for requests without new inputs); audit atomicity; text is
plain and never rendered as HTML

**Scale/Scope**: 1 migration, 1 new core mutation, schema and resource changes, 1 CLI command,
1 HTTP route, 2 web display lines, documentation

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Rules in core | `src/core/recurrence/miss.ts`; CLI and HTTP adapters only parse and call | Lint import rules |
| II. Isolation and audit | Ownership checks; atomic audit; no partial state | Existing `executeMutation` guards with task entity; occurrence events per row | Integration: success audit rows, `PROJECT_MISMATCH`, rollback when one row in a batch is refused |
| III. CLI contract | New command with contract tests | `occurrence miss` with flat input, JSON stdout, stderr refusals | Compiled-CLI tests: success, each refusal, exit codes |
| IV. Mobile and offline | Display only; offline unchanged | Two text lines in the occurrence row; no new controls | Playwright at 430 px, Chromium + WebKit |
| V. Functions, types | Types from Drizzle and Zod | New columns in `src/schema/recurrence.ts`; input schemas in `recurrence-input.ts` | Typecheck, lint |
| VI. Behavior tests | Real databases; regression first | The 11 Nov archive case is written as a failing test first | `npm run test:functional` |
| VII. Performance | No N+1 | Batch selection reuses `selectOccurrences` | Existing occurrence benchmarks unchanged |
| Compatibility | Versioned migration; populated upgrade test; docs | `0004` + test upgrading a populated prior schema; contracts, agent guide, CHANGELOG | Upgrade test; review |
| Privacy | Text stored as typed; never echoed in errors | Refusals name fields, not text (004 FR-020) | Unit: refusal with a reason body contains no reason text |
| Quality gates (owner rule) | Existing gates | No limit changes | CI, pre-push |

## Project Structure

```text
specs/007-occurrence-reasons-and-notes/ plan.md research.md data-model.md quickstart.md
  contracts/occurrence-outcomes.md
drizzle/0004_occurrence_reasons.sql                  # NEW
src/schema/recurrence.ts                             # columns and CHECKs
src/schema/recurrence-input.ts                       # missOccurrencesSchema, note on completion items
src/schema/recurrence-query.ts                       # optional resource fields
src/core/recurrence/miss.ts                          # NEW: missOccurrences
src/core/recurrence/complete.ts                      # store note
src/core/recurrence/snapshots.ts                     # resource fields; null-safe event diff
src/core/recurrence/cancel.ts                        # owed blocker adds close_as_missed hint (with 004)
src/cli/commands/occurrences.ts                      # occurrence miss
src/api/routes/<occurrence routes>                   # POST .../occurrences/miss
web/src/screens/occurrence-row.tsx                   # show reason and note
tests/integration/occurrence-miss.test.ts            # NEW
tests/integration/migration-0004.test.ts             # NEW: populated upgrade
tests/contracts/occurrence-miss-cli.test.ts, occurrence-miss-http.test.ts   # NEW
tests/e2e/occurrence-reasons.spec.ts                 # NEW
specs/001-ai-task-manager/contracts/{cli,http,common}.md, docs/agent-guide.md, CHANGELOG.md
```

**Structure Decision**: existing layering; one new core module for the miss mutation.

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1/2, FR-001 | Miss with open window → missed now; later expiry no change; pending past its window with no tick yet is expired first, then closed | Integration with injected clock |
| US1-3/5 | Reason optional; added once to an existing miss | Integration |
| US1-4, FR-007 | Completed or cancelled → refusal with state and next step | Integration + CLI contract |
| US1-6, FR-006 | Missed then completed keeps reason and shows both | Integration on resource and audit |
| US2, FR-002 | Note stored and shown; text rules enforced | Integration, CLI and HTTP contracts |
| US3-1/2/3/4, FR-003 | Owed → missed with reason; without reason refused; no re-debt after ticks | Integration with clock advance |
| US3-5, FR-011, SC-004 | 11 Nov sequence archives without completion | Integration, regression first |
| US4, FR-005, SC-002 | Web and human output show the text | Playwright; CLI human-mode test |
| FR-004 | Empty, whitespace, 501 characters, malformed Unicode refused | Unit on schema |
| FR-008 | Exact retry returns stored envelope with original identifiers; no new audit rows | Integration |
| FR-009 | Cancel-owed refusal names `close_as_missed` | Integration (with 004) |
| FR-010, SC-003 | Responses for requests without new inputs byte-identical | Contract snapshot comparison |
| Compatibility | Populated schema-3 database upgrades; rows and audit preserved | Upgrade test |

Mutation coverage: success state and audit apply; validation failures apply; ownership
rejection applies (`PROJECT_MISMATCH` for another project's task and for an occurrence of
another parent); rollback applies (batch with one refused row writes nothing). Contention:
existing occurrence race suite covers the shared `executeMutation` path; one added case runs miss
and complete on the same occurrence from two processes and expects exactly one success.

## Migration and recovery

Forward: `0004` adds nullable columns. Rollback: the previous binary cannot read a schema-4
database (schema version check), so recovery uses a verified pre-upgrade backup, as
`docs/compatibility.md` prescribes; the upgrade procedure takes that backup first.

## Dependencies

- 004: blocker shape and the owed hint. If 007 ships first, refusals use the current message style and adopt the shape when 004 lands.
- 006: wording of `completed_late` in the row next to which the reason appears.
- 010: compatibility policy for added fields (owner decision B), reused here.

## Complexity Tracking

No exceptions.
