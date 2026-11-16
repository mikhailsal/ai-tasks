# Implementation Plan: Advisory warnings

**Feature**: `010-advisory-warnings` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Branch**: `010-advisory-warnings`, implemented together with the first provider (011 or 012)
in one change. Planned on `ci-pr-rule-and-hooks` at `bf8bd62` without code changes.

**Input**: `specs/010-advisory-warnings/spec.md` (clarified 2026-11-16: FR-009 = B);
constitution v3.2.0.

## Summary

Add optional `advisories` and `advisories_omitted` keys to success envelopes, filled by
read-only providers registered by later features, computed from current state after reads and
after committed mutations, bounded and ordered, documented in a catalogue checked by a test,
shown on stderr in human mode and on the item in the web. Responses with no advisory stay
byte-identical; the change is announced.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Node.js 24.22.0 (unchanged)

**Primary Dependencies**: Zod 4.6.7, Fastify 5, commander 15, React; none added

**Storage**: none

**Testing**: Vitest unit (shape, bounds, ordering, catalogue parity), integration with a test
provider, compiled-CLI and HTTP contracts, Playwright

**Target Platform**: CLI, HTTP API, mobile web

**Project Type**: Local CLI + HTTP API + web UI

**Performance Goals**: providers run bounded queries; no read exceeds its current goal by more
than 10% on the benchmark dataset (goal)

**Constraints**: byte-identical without advisories; never fatal; no writes

**Scale/Scope**: envelope schemas (about 20 modules accept the new keys), 1 core module, CLI
and HTTP response helpers, 1 web component, 2 documents

## Constitution Check

*Gate before research: PASS. Re-checked after design: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
|---|---|---|---|
| I. Thin adapters | Conditions in core | `src/core/advisories/`; adapters only serialize | Lint import rules |
| II. Isolation and audit | Read-only; project-scoped | Providers get the request's project scope; no writes | Integration: database unchanged; scope test |
| III. CLI contract | Strict envelopes; stderr for human lines | Optional keys; human lines on stderr | Compiled-CLI tests both modes |
| IV. Mobile and offline | Shown on items; cached responses keep their advisories | `AdvisoryNotice`; cache stores the envelope as received | Playwright 430 px, offline cached view |
| V. Types | Typed catalogue union | `AdvisoryCode` union from the catalogue | Typecheck |
| VI. Behavior tests | Proportional | Matrix below | `npm run test:functional` |
| VII. Performance | Bounded provider work | Provider contract: one bounded query per response | Benchmark comparison (goal) |
| Compatibility | Announced change; repo clients updated | CHANGELOG, `docs/compatibility.md`, web schemas in same change | Review; web tests |
| Privacy | No request values, secrets, storage errors | Catalogue text only | Unit: messages are catalogue constants |
| Quality gates (owner rule) | Existing gates | None changed | CI, pre-push |

## Project Structure

```text
specs/010-advisory-warnings/ plan.md research.md data-model.md quickstart.md contracts/advisories.md
src/schema/envelopes.ts                   # optional keys
src/schema/advisories.ts                  # NEW: advisory schema
src/core/advisories/{catalogue,collect}.ts  # NEW
src/cli/io.ts                             # human stderr lines; JSON pass-through
src/api/<response helper>                 # pass-through
web/src/components/AdvisoryNotice.tsx     # NEW
docs/advisories.md (NEW), docs/compatibility.md, CHANGELOG.md, docs/agent-guide.md
tests/unit/advisories.test.ts, tests/integration/advisories.test.ts, tests/contracts/advisories-{cli,http}.test.ts, tests/e2e/advisories.spec.ts
```

## Verification matrix

| Spec outcome | Test | Mechanism |
|---|---|---|
| US1-1, FR-001/002 | Present with code, message, remedy; result unchanged | Integration with provider on/off |
| US1-2, US4-1, FR-009 | Absent and byte-identical | Contract snapshots |
| US1-3/4, FR-004 | Bound, order, omitted count, aggregation | Unit |
| US2, FR-005 | Every read while the condition holds; gone after | Integration |
| US3, FR-006/007, SC-004 | Web notice; human stderr line | Playwright; CLI test |
| FR-003, SC-002 | Catalogue equals docs | Unit |
| FR-008 | Messages are catalogue constants | Unit |
| US4-2/3/4 | Docs present; web accepts | Review; web tests |
| Failure | Provider error → no advisory, success | Integration |

Mutation coverage: N/A (no mutation added); mutation responses are covered for presence after
commit and on replay. Contention N/A.

## Migration and recovery

None. Reverting removes the keys.

## Dependencies

- 004: Hint shape for `remedy`.
- Ships with 011 or 012 (first provider).

## Complexity Tracking

No exceptions.
