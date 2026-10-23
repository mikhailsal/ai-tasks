# Research and decision record: Project-first mobile Kanban

**Updated**: 2026-10-23. Sources: user discussion, existing repository/workflow/API and constitution 3.0.0. Runtime evidence is recorded separately in quickstart.md.

## User-confirmed decisions

- Work by project: choose a project, then inspect its tasks.
- Understand each task's workflow stage through a Kanban-style board.
- Swipe a finger horizontally to inspect adjacent columns, as in Trello; a vertical grouped-stage list is not the selected interaction.
- Keep the interface compact and mobile-app-like. Discuss the specification before resuming application code.

- Sketch A was accepted as the visual direction, with the addition of task search. The search icon must open a working project-scoped search rather than an informational placeholder.

- User-confirmed request: drag tasks to reorder within a column with persistence and drag across columns to change workflow stage. The requested behavior does not specify the gesture mechanics below; those remain proposed.
- The user requested an immediately visible ordinary/recurring board toggle. Use a compact labeled two-segment control in the search/filter/add toolbar row below the project header; no separate full-width row; retain separate reading/search context for each kind. This supersedes the earlier proposal to put recurring tasks only in a secondary menu.

## Proposed design defaults for review

- Most of one column fills the screen, with a small neighboring-column preview. Native horizontal scroll snap and independent vertical card scrolling preserve familiar gestures.
- Stage selectors support accessibility and quick jumps. Proposed long-press handle drag reorders within a column or transfers to a permitted stage; ordinary swipe never mutates. Transfer must reuse guarded lifecycle behavior.
- Configured stage IDs/order define columns; general categories do not merge custom stages.
- Ordinary and recurring workflows remain separate boards selected by the user-confirmed visible switch. Terminal columns remain explicitly accessible. These defaults are proposals, not individually supplied user answers.
- Per-column bounded pagination/cache with truthful partial counts avoids an unbounded project download or a new count API. Detail/back and post-mutation invalidation are required; cached views must not remain stale after successful writes.
- Shared existing buttons/preview/filter/offline components remain candidates for reuse. No new dependency is planned; shared persisted board order and a guarded order/transfer mutation are now proposed; deadline filtering adds an optional backward-compatible task-read parameter as described below.

## Priority/deadline filter decision

The user requested a filter icon beside search/add with choices such as high priority, today, tomorrow+ and a three-day window. Use a compact bottom sheet, explicit apply, AND composition, visible active summary and reset; keep independent state per project/kind. Interpret the three-day option explicitly as today plus the next two calendar days and name it “Ближайшие 3 дня”.

Source inspection: `src/schema/task-query.ts` already supports priority but no deadline range/preset; `statisticsInputSchema` from/to filters only statistics and cannot filter task cards. Therefore the implementation plan must include an optional `deadline_preset` shared read filter with existing trusted clock/timezone/cursor rules, rather than falsely claim frontend-only changes or filter a partial loaded page. The deadline read-filter alone needs no migration; board order and guarded transfers require a proposed database migration and mutation contract.

## Search design

Use a compact field opened from the board toolbar and vertically scrollable results showing each task's stage. Search all stages of the selected project/workflow via existing server-side title/description matching; do not mistake already fetched column cards for the whole search corpus. Retain query/results on detail return and restore the board on cancel. The standalone sketch demonstrates this with sample data only.

## Superseded draft

The earlier 002 draft chose an aggregate list-first home, compact sync and a three-item bottom bar. A partial prototype and historical check artifacts exist. The user clarified project-first swipeable Kanban afterward; the prototype is not an approved design or accepted implementation. Existing improvements may be reused only when they fit the reviewed board design. The user subsequently reviewed the revised sketch and explicitly authorized implementation and a final commit.


## Board order and drag interaction (proposed)

The user requested within-column reorder with persistence and cross-column drag to change workflow stage. Proposed order scope is project + task kind + status, shared across devices/reloads and independent of priority/deadline sort. Seed order deterministically; append new tasks and tasks entering through non-positioned lifecycle actions. Board cross-column drag inserts at the explicit known destination position and appends only when the user chooses the end. Disable reorder while search or any filter is active or target membership is partial. Use a deliberate long-press handle; swipe remains navigation. Edge auto-advance is needed for distant columns. Provide keyboard/menu equivalents.

Cross-column drop must invoke existing transition validation and consent/dependency/required-field/archive/offline rules. Invalid drops restore the card; stale task version or source/destination order revision returns a visible conflict, never an automatic retry. Task status and source/destination order consistency is a required atomic guarantee. Audit current service/API/CLI support and transition transaction boundaries to choose an implementation mechanism that meets it; include idempotency and optimistic concurrency. The mechanism is proposed, while the consistency guarantee is required. A real shared-state DB migration is proposed; the standalone synthetic sketch may use localStorage solely to demonstrate sample ordering/status.

Acceptance needs real touch tests distinguishing drag from horizontal and vertical swipe, edge navigation, cross-device/reload order, filtered/partial disablement, invalid destination/guard rollback, stale revision rollback, and service/API/CLI parity. Bound fetches to known target membership and do not represent hidden filtered rows as absent.


## Additional user requirements (2026-10-23)

- Persisted board order must live authoritatively in the shared application database and work independently of browser/device storage. LocalStorage in the sketch is synthetic-only.
- Search uses a consistent vector icon. Emoji and title align in one row with correct narrow-screen title wrapping.
- Backdrop/outside press, Escape and Cancel always discard pending dialog changes; they never Apply/Confirm, including pending filters or drag state.
- Task detail opens directly editable with explicit Save/Cancel. Preserve read-only/offline/guards/conflicts/drafts/exact Markdown.
- Clickable priority tags filter exact priority; deadline tags filter that exact local calendar day (tomorrow means tomorrow only); stage tags filter the exact configured status ID. Filters open same project/kind board/list, stay visible/removable, compose compatibly and replace the same dimension. Tag click does not open/drag the card. Blocker remains explanatory, not a fictional filter or new tag domain.
- Clicking the board project title opens that project's editor; back restores the board.
- Detail exposes discoverable real immutable audit history, including stage/order changes when available, with truthful paging/loading/empty/error/offline states.
- Prototype mechanics are a synthetic sketch owner deliverable; application implementation is authorized and under validation. Implementation authorization comes from the user’s explicit instruction after sketch review.
