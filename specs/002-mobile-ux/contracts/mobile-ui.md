# Project-first mobile Kanban contract

Baseline [UI contract 001](../../001-ai-task-manager/contracts/web-ui.md), [HTTP](../../001-ai-task-manager/contracts/http.md), [common](../../001-ai-task-manager/contracts/common.md) and [CLI](../../001-ai-task-manager/contracts/cli.md) continue to govern operations and protections. This revision adds frontend presentation/gesture behavior, shared persisted board ordering and guarded status transfers, plus an optional backward-compatible deadline read filter. Sketch A is accepted as the visual direction; project task search and shared persisted manual order with board reorder/status transfer are in scope. Implementation authorized by the user after acceptance of sketch A; all agreed requirements remain in scope.

## Entry, scope and layout

- `/` presents the project chooser; selecting an active project opens the client route `/projects/:slug/board`. Preserve existing project detail/configuration and aggregate task URLs as secondary destinations; no server/API route replacement.
- Show the selected project's emoji/name and an add-task action above the board. Project settings/history are secondary menu actions. Adding binds the slug and preserves configured initial-status creation, regardless of the viewed column.
- Center the mobile viewport at max-width 430px, with ≥44×44 targets. Within it, the board is an intentionally horizontally scrollable track. The root/document, forms and cards must not become wider than the viewport. This is one visible mobile column at a time, not a desktop multi-column layout.
- Proposed column geometry: most of the available board width, with a narrow next-column preview. Exact spacing/type/colors are accepted through visual examples, not inferred solely from geometry tests.

## Visible board-type switch

- Place a compact segmented “Обычные / Повторяющиеся” control in the same toolbar row as search/filter/add directly below the project header. Do not allocate a separate full-width switch row. Its visual track may be about 36px high while the final implementation retains ≥44px hit areas; keep an accessible group label and a clear selected state. The control remains visible while searching; neither type is hidden in the project menu.
- Keep the same selected project. Use `kind=ordinary` or `kind=recurring` in task/search queries and the corresponding configured workflow. Adding inherits that explicit kind and still requires the usual ordinary deadline or recurring schedule inputs in the existing form.
- Scope board cache and presentation positions by project + kind + configuration/epoch as applicable. Retain independent selected stage, column scroll and search context when toggling. Offline switching may display fetched snapshots or a clear cache miss; it must not enable writes.
- Recurring columns represent parent lifecycle statuses (default draft/active/paused/archived), and counters count parents. Occurrence completion/misses/debt remain separate detail operations and never implicitly move a parent between columns. Merely switching performs no mutation.

## Columns and gestures

- Derive columns from the selected kind’s `ordinary_workflow.statuses` or `recurring_workflow.statuses` in configured array order. Key by status ID, never label/category; multiple statuses in one category remain distinct. Show configured label and truthful count/loading state. Do not mix recurring lifecycle statuses into ordinary columns.
- Use native horizontal scrolling with CSS scroll snap; vertical lists scroll independently. Swiping settles on an adjacent column with no wraparound. Do not intercept all touch events/preventDefault; preserve vertical gestures, card taps and browser edge navigation. Support reduced motion.
- A stage selector/previous-next controls provide equivalent keyboard and touch alternatives. Keep active stage indication synchronized with the settled viewport; visible names and counts must not break mid-word.
- Swiping navigates only. A deliberate long-press on a visible drag handle supports within-column reorder and cross-column transfer; ordinary swipe remains navigation only. Cross-column drop invokes existing allowed-transition rules, consent, dependency and required-field guards. Invalid drops restore the card; conflicts are visible and never silently retried. Keyboard/menu equivalents are required. Transfer must atomically keep task status and source/destination order consistent using expected task version and both order revisions; implementation mechanism follows transaction audit.
- Retain per-project selected stage and per-column vertical position while opening detail/back navigation. Reconcile missing stages after configuration migration instead of reusing an unrelated status ID.

## Data, pagination and refresh

- Reuse explicit project-scoped configuration and task reads. Query columns by `status_id`, not a general category. Load the current column first; neighbor prefetch may reuse the cache. No request per card or unbounded preloading of all project tasks.
- Preserve cursor/as_of semantics within each column; disclose independent column snapshot times rather than claiming one atomic board snapshot. Changed cursor/config/epoch requires reconciliation.
- Each column has its own pagination/loading/error/cache state. Empty means a successful complete empty result, never unfetched/failed. Display loaded counts as incomplete (for example `50+`) while more pages exist; never claim loaded counts are complete totals. Precise server-total counters, if required later, need a separately reviewed API change.
- After successful create/edit/transition/restore/reorder, invalidate and refresh affected board queries. A moved task appears in its actual destination once; Infinity-stale cached views must not survive successful writes unchanged. Preserve selected stage/position where possible.
- Offline browsing works for fetched columns only; an unfetched neighbor explains missing saved data. Disable all mutations and preserve existing draft/reconnect/new-epoch guards.

## Toolbar filters and deadline read contract

- Show an accessible filter icon beside search and add in the same compact toolbar row as the kind switch. A bottom sheet contains priority and deadline choices; keep permanent controls compact at 320px. Highlight active filters and show a compact readable condition summary with reset outside the sheet.
- Priority controls follow the selected project's model: classic levels, named configured choices, Eisenhower flags or numeric values. Sketch A uses classic levels as sample data; never assume every project has a “high” level.
- Deadline choices: any (unset parameter), `overdue`, `today`, `from_tomorrow`, `next_3_days`, `undated`. User labels are “Любой срок”, “Просрочено”, “Сегодня”, “Завтра и позже”, “Ближайшие 3 дня”, “Без срока”.
- Draft selections change results only after “Показать задачи”; close/cancel discards draft changes. Reset in the active summary immediately clears applied priority/deadline. Priority AND deadline AND search/scope compose; kind switching retains independent applied filters.
- Current `taskReadFilterShape` supports priority but **not** task-list deadline presets. Plan an additive optional `deadline_preset` enum for shared task read inputs and their API/CLI transport allowlists. Preserve every old query without the parameter. This is a bounded read-contract extension, not a new mutation/schema migration. Do not substitute local filtering of incomplete pages.
- Apply deadline predicates to the existing effective/display deadline: ordinary deadline, or recurring parent's earliest pending/debt deadline. Let `D0` be local midnight of the response's frozen `as_of` in application timezone; `D1` tomorrow's midnight and `D3` midnight three calendar days later. `today` is [D0,D1), `from_tomorrow` is [D1,infinity), `next_3_days` is [D0,D3); undated excludes every range; `undated` selects null. Overdue uses deadline < as_of and existing unfinished/lifecycle semantics, never treats completed work as overdue. Calendar days are not fixed 24-hour millisecond spans across DST.
- Freeze relative interpretation across pagination using the existing cursor/as_of/config/settings invalidation rules. Filter identity participates in cursor/cache scope. No caller clock override or implicit expiry/state mutation is added.
- Add real injected-clock read/transport tests for date boundaries, offset/timezone/DST, nulls, recurring effective deadlines, project/kind isolation, conjunction, pagination and invalid preset rejection. No new database columns/dependencies are required.

## Project task search

- A labeled search icon in the board toolbar opens a compact search field with clear and cancel controls. Do not keep a large search form permanently above the board.
- Search the selected project's current workflow across all its stages, not just the visible column or fetched cards. Reuse existing server-side `q` title/raw-Markdown substring semantics and explicit project/kind/filter scope; no search API replacement is needed. Preserve case-insensitive matching and literal special-character behavior.
- Show results as a vertically scrollable list with the configured stage label on each result. Query-based paging retains snapshot/cursor semantics and truthful result counts; completed/archive/recurring visibility follows explicit scope/filter state rather than hidden exclusions.
- Opening a result and returning retains query, results and search scroll. Clear keeps the field open; cancel restores the board's prior column and per-column vertical positions. Query input never changes task state.
- Distinguish initial guidance, loading, no matches and network failure. Offline, use only an applicable previously saved search snapshot or explicitly explain unavailable/incomplete results; never claim a project-wide search from a partial local column cache.
- The sketch uses only its synthetic sample tasks; the application must search the server's project data even when a matching task's stage/page has not been fetched.

## Visual hierarchy and secondary operations

- Compact cards: title/emoji primary; deadline/priority/blocker indicators secondary. The project header and column label supply context. Exact deadline/timezone, absent optional values and copy actions remain available in detail.
- Buttons distinguish primary/secondary/ghost/danger; no payload/confirmation changes. Sync stays compact normally and visible on errors/offline/maintenance. All existing search/filter/metadata/configuration/history/recurrence/backup operations remain available in secondary views/disclosures.
- The accepted `design/sketch.html` is the concrete reference for the main screen hierarchy, toolbar, editor headers and fixed action footers. Application controls retain their plain hover appearance; keyboard focus stays visible. Validate by viewing actual screens, not viewport geometry alone.
- Task descriptions open as ordinary text editing. Formatting help, rendered preview, exact source view and technical metadata are secondary disclosures. Keep server-sanitized Markdown rendering/source faithful for existing content; do not insert Markdown into descriptions or introduce a new dialect or image/raw-HTML support.
- Secondary pages have a visible Back control. Return to the actual internal originating board/project/search URL when available, with a safe in-app fallback for direct entry. Board and editor headers supply their own Back control without duplicate navigation rows.
- Normal board sync and stage position share a compact footer. Error messages can be dismissed without discarding a pending operation, receipt or draft; storage failures continue to prevent unsafe writes.

## Acceptance

Sketch A project chooser/board/detail is accepted as the visual direction. Application implementation was explicitly authorized after the sketch review. Reproduce board regressions first, include a real insecure LAN HTTP browser origin (localhost is insufficient for browser API support), test actual directional gestures in Chromium/WebKit, keyboard alternatives, returns/refresh, pagination/custom statuses and existing safety/offline suites. Capture/review real 320px and 390px screenshots; run the strict JS gzip gate (<170000 bytes including SW/lazy chunks under the user-approved temporary plan exception; baseline 150000). Superseded list-prototype results are historical evidence only.


## Proposed persisted order and drag contract

- Persist a shared manual order keyed by project + kind + status, with an order revision; use a deterministic initial order; append new tasks and tasks entering through non-positioned lifecycle actions. Cross-column board drag inserts at the explicit user-chosen known destination position, appending only when the user chooses the end. It survives reloads and is consistent across devices. The shared database is authoritative and independent of browser/device storage; localStorage alone cannot satisfy this requirement. This is real application state requiring a database migration. The synthetic sketch may use localStorage for sample behavior only.
- Manual order is independent of priority/deadline sorting. Disable reorder while search or any filter is active, or target membership is partial; do not infer hidden/unknown tasks are absent. Limit reads and writes to known target membership.
- The order operation must have service/API/CLI parity, idempotency and optimistic concurrency. Same-column reorder validates the source order revision. Cross-column operation atomically keeps task status and both source/destination orders consistent against expected task version and both order revisions, applies the existing guarded transition, and inserts at the chosen destination position. Audit the existing service to determine the implementation mechanism; the atomic consistency guarantee is required. Never bypass guards or write status directly.
- A rejected destination/guard restores the card to its prior visual position. A version/revision conflict shows current state and requires an explicit retry. Offline and archived projects cannot mutate.
- Acceptance covers actual long-press handle drag versus ordinary horizontal/vertical swipe, edge auto-advance, invalid statuses, consent/dependency/required-field rollback, reload/cross-device persistence, concurrent conflict rollback, keyboard/menu parity and bounded target queries. These checks verify the agreed behavior; implementation details are owned by the plan and transport contract.


## Detail, modal dismissal and contextual navigation requirements

- The search action uses a consistent vector icon, never a text glyph that can render broken. In task cards/details, emoji and title align on the top row where space allows; long titles wrap without clipping on narrow phones.
- Dialog backdrop/outside press and Escape are Cancel semantics: discard pending changes and never Apply or Confirm. This remains true when filters or a drag are pending. Apply/Confirm require their explicit controls.
- Task detail opens directly editable without an Edit-mode step. Save explicitly commits drafts and Cancel discards them; existing read-only, offline, archive/lifecycle guards, conflicts, drafts and exact Markdown source remain authoritative.
- A project title on Kanban opens that project's editor. Back restores the selected project's board and reading context.
- Clickable priority tags filter the exact priority; deadline tags filter the exact local calendar day shown (for example, a tomorrow tag means tomorrow only); stage tags filter the exact configured status ID. Open the same project's same-kind board/list, visibly retain the filter with a reset/removal control, preserve compatible other dimensions and replace an existing selection in the same dimension. Stage is an explicit removable filter, not only a tab switch. Tag clicks do not open or drag the card. A blocker badge is explanatory and is not represented as a filter unless a real supported filter exists; do not invent a tag domain.
- Deadline exact-day tag filtering, if needed by the shared read contract, is additive and must use application timezone plus frozen as_of/cursor semantics. The tag itself and its active label must identify that exact day.
- Task detail exposes a visible, discoverable change-history section backed by actual immutable audit events. Include stage/order events when recorded; render truthful loading, paging, empty, error and offline states. Never synthesize audit entries.

## Editor follow-up contract

- The entire task description grows into the page on load, editing and resizing; retain source bytes, secondary formatting and page scrolling.
- Dirty task/project departure confirms before leaving through internal links, closing project forms or browser Back. Rejecting preserves URL/form/source; accepting never implicitly saves to the API and retains existing draft recovery. Browser reload/close uses native unsaved-change confirmation. Successful save, explicit task discard and unchanged forms leave without false warnings.
- Project emoji is a primary field in both creation and editing.
- Eisenhower priority and expanded deadline each use sufficient normal-flow space at 320/390px, with no overlap or horizontal overflow. Checkbox marks are compact; activation areas remain at least 44px.
