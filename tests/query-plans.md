# Read-query evidence

US4 uses the production SQLite migrations and the mixed ordinary/recurring fixture in
`tests/fixtures/read-views.ts`. The accepted source gate is
`artifacts/checks/2026-10-22T00-54-31.639Z-functional.json` (28 assertions,37.765s),
including all five cases in `tests/integration/query-plans.test.ts`. The final joined
US4 regression also passes all1404 cases/90 files in145.137s
(`artifacts/checks/2026-10-22T02-11-41.603Z-functional.json`), retaining these same checks.

The fixture records each actual prepared SQL statement and its bound values while
calling the native SQLite statement. It executes `EXPLAIN QUERY PLAN` on those same
statements and bindings; a hand-written approximation is not used.

| Read path                                | Verified plan / query-count condition                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Project-scoped task parent list          | Uses `tasks_project_list`.                                                                           |
| Project-scoped task emoji search         | Uses `tasks_project_emoji`.                                                                          |
| Earliest pending/debt recurring deadline | Uses `occurrences_task_state_deadline_idx`; the task-list plan rejects a full occurrence-table scan. |
| Task list, one versus fifty parents      | Same nonzero number of executed read statements; no more than8.                                      |
| Agenda, one versus fifty parents         | Same number of executed read statements; no more than10; indexed occurrence lookup retained.         |
| Priorities, one versus fifty parents     | Same number of executed read statements; no more than10; indexed occurrence lookup retained.         |

Counts include metadata and explicit-project reads, so increasing page size cannot hide
per-parent configuration or relation queries. These are measured equality/bound checks,
not an assertion that every supported scope issues an identical absolute count.
Parent pages are limited in SQL before resource mapping. The correlated earliest-open
lookup remains inside the indexed SQL statement. Project configuration is joined once
and parsed once per selected project; no application N+1 reads are issued.

Agenda ordering adds the server-selected calendar bucket after project order and before
model-specific ties. Priority ranking stays within each project. Computed bucket/model
sorts may require SQLite temporary sorting; no new index was justified by these plans.
Statistics uses two grouped SQL aggregate reads plus metadata/project lookup and applies
each metric's timestamp bounds separately. It does not fetch each task's occurrences.

The fixtures also compare complete domain snapshots before/after reads. No read ticks,
expires occurrences, writes audit/receipts or changes the captured pagination reference
instant. The live benchmark and its timing goals are validated separately in T104/T107.
