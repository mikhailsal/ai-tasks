# Data model: existing domain, new board presentation state

Project, task, workflow status and snapshot meanings remain governed by [model 001](../001-ai-task-manager/data-model.md) and [HTTP contract](../001-ai-task-manager/contracts/http.md). Shared persisted board order is added by migration `0003_shared_board_order.sql`; operation fields are defined in [board API/CLI contract](contracts/board-api.md).

A board column represents a configured ordinary status ID in configured order. Same-category statuses remain separate; recurring lifecycle statuses are not ordinary columns. Selected project/status and per-column vertical position are presentation state, scoped by project and reconciled against config/epoch changes.

Each column retains existing pagination/snapshot/cache identity. `meta.as_of` governs that result set; separate column reads are not falsely advertised as one atomic snapshot. Unfetched, partially loaded and complete-empty results remain distinct; loaded counts are not server totals.

Existing task fields and cache/draft formats remain unchanged; board-order storage and its write contract are additive changes. Shared task read inputs/API/CLI gain optional deadline preset and exact local calendar-day filtering for contextual deadline tags; omitted parameters preserve existing read behavior. Use the application timezone and frozen as_of/cursor semantics. The live demonstration database receives no verification writes.

Project search adds transient query/result/scroll context scoped by project, workflow and explicit filters. Existing task `q` reads and cached snapshot semantics remain authoritative; it adds no domain entity or server-search index.

The visible board switch selects existing `ordinary`/`recurring` kinds; it adds no task type or mutation. Presentation/cache scope includes project + kind. Recurring columns/counts concern parent lifecycle; individual occurrences remain separate entities/actions.

Priority and deadline filters are presentation/query state scoped by project/kind. The additive deadline read preset uses the existing effective deadline and frozen reference time; it introduces no persisted domain field. Filter identity belongs in cursor/cache keys.


## Proposed shared board order and transfers

Manual order is shared application data keyed by project + kind + status, with a deterministic initial ordering and a revision for optimistic concurrency. Reorder changes this order independently of priority/deadline sorting. New tasks and tasks entering through non-positioned lifecycle actions append. A cross-column board drag inserts at the user-chosen known destination position and appends only when the user chooses the end. Do not submit reorder while search/filter is active or target membership is partial; otherwise a client could incorrectly claim unseen tasks are absent. The sketch may store sample order/status in localStorage only; that is synthetic presentation behavior. In the application, the shared database is authoritative and browser/device local storage is not a persistence substitute.

A cross-status drag is a lifecycle transition request, not a direct status write. Reorder carries and checks the source order revision. A cross-column transfer carries expected task version plus source and destination order revisions and atomically keeps task status and both orders consistent while applying existing transition guards and the chosen insertion position. Service, API and CLI need parity, idempotency and conflict behavior. A stale task/source-order/destination-order revision must return a visible conflict; no silent retry. The atomic consistency guarantee is required; implementation must follow an audit of existing transition transactions.


Contextual tag filters are query/presentation state, not a new tag domain. Priority applies an exact model value; deadline applies the exact displayed local calendar day; stage applies the configured status ID. Each is visibly removable and composes with compatible dimensions. A blocker badge remains explanatory. Directly editable detail uses explicit save/cancel drafts, retaining existing guards and exact Markdown. Change history reads immutable audit records and never fabricates events.

## Implemented storage and derived read data

`board_order` holds task ID, project slug, kind, configured status ID and integer position; an index covers project/kind/status/position/task ID. `board_columns` holds an independent optimistic revision for each project/kind/status. Migration assigns deterministic creation/ID order to every existing task, including archived tasks. All lifecycle entry writers synchronize this state; same-column archival preserves position, restoration/non-positioned entry appends, and an explicit drag selects a known destination anchor.

List, board and search resources derive an optional `blocked` flag through two bounded dependency reads per page using the existing prerequisite completion rules. This adds no task field, state transition or per-card query. Exact deadline filtering uses `deadline_day`; broad relative choices use `deadline_preset`, mutually exclusively.
