# Quickstart validation: Advisory warnings

**Feature**: `010-advisory-warnings` | **Date**: 2026-11-16

The mechanism ships with a provider from 011 or 012; validation uses a test-only provider
registered in the functional test setup and the first real provider.

1. **Absent (US1-2, US4-1)**: existing contract suites green; snapshot of a response without
   conditions is byte-identical to the previous build.
2. **Present (US1-1)**: trigger the real provider's condition; JSON response carries one
   advisory; `data`, `meta`, exit status and database unchanged versus the same request with the
   provider disabled.
3. **Bound and aggregation (US1-3/4)**: test provider yields 15 per-item and 30 identical
   conditions → 10 advisories, `advisories_omitted`, aggregated entry with `count`.
4. **Persistent (US2)**: read the item twice → present; remove the condition → absent.
5. **Human and web (US3)**: human mode stderr line, stdout unchanged; web shows the notice on
   the item (`npm run test:e2e`).
6. **Catalogue (FR-003)**: unit test compares catalogue and `docs/advisories.md`.
7. **Provider failure**: test provider throws → response succeeds without advisories.
