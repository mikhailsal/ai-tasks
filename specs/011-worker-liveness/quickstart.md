# Quickstart validation: Worker liveness

**Feature**: `011-worker-liveness` | **Date**: 2026-11-16

Scratch database only; never the live service.

1. **Never (US1-3)**: new project; `meta --json` shows `never`; occurrence read of a recurring
   task carries `worker_never_ran`.
2. **Healthy (US1-1)**: `worker run --project demo` in the background on the scratch database;
   after ready, status `healthy` with `last_pass_at`; no advisory.
3. **Stale (US1-2, SC-001)**: stop that worker (its own PID from the test harness); with the
   injected clock advanced past 5 minutes, status `stale` and the advisory appears.
4. **Resume (US1-4)**: start again → healthy.
5. **No dependents (US2-3)**: project without recurring tasks: no advisory while stale.
6. **Clock steps (SC-004)**: integration test of 100 passes with clock steps ±2 min and −1 h:
   zero stale reports.
7. **Restore**: restore a backup taken during step 2 → status from its stored time.
8. **Web (US3)**: notice on project and occurrence screens (`npm run test:e2e`).
