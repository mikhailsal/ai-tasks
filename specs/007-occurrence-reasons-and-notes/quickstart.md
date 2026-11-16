# Quickstart validation: Reasons and notes

**Feature**: `007-occurrence-reasons-and-notes` | **Date**: 2026-11-16

Scratch database only (`AI_TASKS_DB_PATH` in a temporary directory, `npm run db:migrate`).

1. **Miss now with reason (US1)**: active daily task, pending occurrence with open window:
   `occurrence miss` with reason «он сказал нет» → `missed`, `miss_reason` and its time set; tick
   past the window → unchanged.
2. **Reason optional and added later (US1-3/5)**: miss without reason on a record-miss task, then
   miss again with reason → same row, reason added, one audit event each.
3. **Note (US2)**: complete with `note` «время примерное» → `completion_note` present; complete
   without note → response identical to the previous build.
4. **Close owed (US3, FR-003)**: carry-forward task with an owed occurrence: miss without reason
   → refused `reason_required`; with reason → `missed`, original `missed_at` kept; later ticks →
   stays `missed`.
5. **Retired schedule (FR-011, SC-004)**: the 11 Nov sequence: pause, cancel future pending,
   close the old owed occurrence as missed with a reason, `task archive` → success; no
   `completed*` state anywhere in the task's history.
6. **Refusals (FR-007)**: miss a completed occurrence → refused with state and next step.
7. **Web (US4)**: occurrence details show the reason and the note (`npm run test:e2e`).
8. **Upgrade**: run the populated-schema upgrade test (`npm run test:functional`).
